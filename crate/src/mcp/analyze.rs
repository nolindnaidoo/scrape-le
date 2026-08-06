//! `analyze_robots_txt` — the tool the npm server (`scrape-le-mcp`)
//! also offers, implemented here so one tool name works whichever
//! server a host has configured.
//!
//! **This is the same tool, not a similar one.** Schema, path handling,
//! result envelope, cap behaviour and error messages all match
//! `src/mcp/tools.ts`, and `fixtures/mcp-analyze-robots.json` is run
//! against both implementations so they cannot drift.
//!
//! It makes no network request, deliberately: the caller passes the
//! robots.txt it already fetched. Fetching an arbitrary origin inside
//! an agent loop would be an SSRF primitive — `http://169.254.169.254/
//! robots.txt` resolves on a cloud host, and the URL comes from the
//! model rather than the user.

use serde::Serialize;
use serde_json::{Value, json};

use crate::detect::robots::parse_robots_txt;
use crate::detect::url::{normalize_url, validate_url};

/// Result caps, in units of "what fits in a context window". Not
/// performance limits — the consumer is a language model with a finite
/// context, and an unbounded result is the difference between a useful
/// answer and a conversation that dies mid-sentence.
pub(super) const DEFAULT_MAX_RESULTS: usize = 500;
pub(super) const MAX_MAX_RESULTS: usize = 5000;

#[derive(Debug, Serialize)]
pub(super) struct Diagnostic {
    pub(super) severity: &'static str,
    pub(super) code: &'static str,
    pub(super) message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AnalyzeData {
    path: String,
    allows_crawling: bool,
    #[serde(skip_serializing_if = "JsNumber::is_none")]
    crawl_delay: JsNumber,
    disallowed_paths: Vec<String>,
    sitemaps: Vec<String>,
}

/// JavaScript has one number type, so the npm server emits `10` for a
/// whole crawl-delay while Rust would emit `10.0`. These two servers
/// offer the *same* tool, so the bytes must agree — a caller diffing
/// their output should find nothing.
#[derive(Debug)]
struct JsNumber(Option<f64>);

impl JsNumber {
    fn is_none(&self) -> bool {
        self.0.is_none()
    }
}

impl Serialize for JsNumber {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self.0 {
            Some(seconds) if seconds.fract() == 0.0 && seconds.is_finite() => {
                serializer.serialize_i64(seconds as i64)
            }
            Some(seconds) => serializer.serialize_f64(seconds),
            None => serializer.serialize_none(),
        }
    }
}

#[derive(Debug, Serialize)]
struct Meta {
    tool: &'static str,
    count: usize,
    truncated: bool,
}

#[derive(Debug, Serialize)]
struct Envelope {
    /// Reports whether the analysis ran, not whether crawling is
    /// permitted: a robots.txt that disallows the path is the answer,
    /// not a failure to produce one.
    ok: bool,
    data: AnalyzeData,
    diagnostics: Vec<Diagnostic>,
    meta: Meta,
}

/// Runs the tool. `Err` carries a message the caller reads as a
/// tool-level failure (`isError`), never a protocol error — the
/// argument was wrong, the server is not broken.
pub(super) fn analyze(arguments: &Value) -> Result<Value, String> {
    let content = read_string(arguments, "content")?;
    let target = read_string(arguments, "path")?;
    let max_results = read_max_results(arguments)?;

    let (pathname, path_note) = to_pathname(&target);
    let diagnostics: Vec<Diagnostic> = path_note
        .map(|message| {
            vec![Diagnostic {
                severity: "warning",
                code: "robots",
                message,
            }]
        })
        .unwrap_or_default();

    let info = parse_robots_txt(&content, &pathname, None);
    let total = info.disallowed_paths.len();
    let truncated = total > max_results;
    let disallowed: Vec<String> = info
        .disallowed_paths
        .into_iter()
        .take(max_results)
        .collect();

    let envelope = Envelope {
        // A note is a warning, not an error, so `ok` stays true — the
        // analysis ran.
        ok: !diagnostics.iter().any(|d| d.severity == "error"),
        meta: Meta {
            tool: "analyze_robots_txt",
            count: disallowed.len(),
            truncated,
        },
        data: AnalyzeData {
            path: pathname,
            allows_crawling: info.allows_crawling,
            crawl_delay: JsNumber(info.crawl_delay),
            disallowed_paths: disallowed,
            sitemaps: info.sitemaps,
        },
        diagnostics,
    };
    Ok(serde_json::to_value(envelope).expect("envelope serializes"))
}

/// The path robots.txt rules are matched against.
///
/// Rules apply to a path, not a whole URL, so a caller that passes
/// `https://example.com/admin` has to have it reduced to `/admin` —
/// matching the full URL against `Disallow: /admin` would silently
/// never match and report everything as allowed, which is the
/// dangerous direction to be wrong in.
fn to_pathname(target: &str) -> (String, Option<String>) {
    let trimmed = target.trim();
    if trimmed.starts_with('/') {
        return (trimmed.to_string(), None);
    }

    // Only an explicit scheme makes this a URL. Normalising first would
    // read `admin` as the *host* `https://admin`, whose pathname is
    // `/` — and `/` matches no Disallow rule, so a path the caller
    // meant to check would come back allowed. Guessing wrong toward
    // "you may crawl this" is the one direction that causes harm.
    if trimmed.contains("://") {
        let candidate = normalize_url(trimmed);
        if validate_url(&candidate)
            && let Ok(parsed) = url::Url::parse(&candidate)
        {
            return (parsed.path().to_string(), None);
        }
    }

    let pathname = format!("/{}", trimmed.trim_start_matches('/'));
    let note = format!(
        "`{target}` has no leading slash and no scheme; it was read as the path {pathname}."
    );
    (pathname, Some(note))
}

/// The message names the argument because the caller is a model
/// choosing what to send next: "content is required and must be a
/// string" is actionable, "invalid arguments" costs a round trip to
/// learn nothing.
fn read_string(arguments: &Value, name: &str) -> Result<String, String> {
    arguments
        .get(name)
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| format!("{name} is required and must be a string"))
}

/// Note the asymmetry: a nonsensical value throws, while a merely
/// excessive one is clamped. The first is a bug in the caller that it
/// needs to hear about; the second is a caller asking for everything,
/// which is reasonable. Clamp quietly, reject loudly.
fn read_max_results(arguments: &Value) -> Result<usize, String> {
    let Some(raw) = arguments.get("maxResults") else {
        return Ok(DEFAULT_MAX_RESULTS);
    };
    if raw.is_null() {
        return Ok(DEFAULT_MAX_RESULTS);
    }
    let invalid = "maxResults must be a positive integer".to_string();
    let value = raw.as_u64().ok_or(invalid.clone())?;
    if value < 1 {
        return Err(invalid);
    }
    Ok(usize::try_from(value)
        .unwrap_or(MAX_MAX_RESULTS)
        .min(MAX_MAX_RESULTS))
}

/// The schema, matching `src/mcp/tools.ts` field for field. The name is
/// a public API with no deprecation channel — once an agent's prompt or
/// memory references `analyze_robots_txt`, renaming it breaks silently.
pub(super) fn definition() -> Value {
    json!({
        "name": "analyze_robots_txt",
        "description":
            "Given the contents of a robots.txt file and a path, report whether the generic \
             (User-agent: *) rules permit crawling it, along with the crawl delay, the \
             disallowed patterns and any sitemaps. Takes the file contents directly and makes \
             no network request of its own — fetch robots.txt with your own HTTP tool and pass \
             what it returned.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "content": {
                    "type": "string",
                    "description": "The contents of the robots.txt file.",
                },
                "path": {
                    "type": "string",
                    "description":
                        "The path to check, e.g. \"/admin\". A full URL is accepted and reduced \
                         to its path.",
                },
                "maxResults": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": MAX_MAX_RESULTS,
                    "default": DEFAULT_MAX_RESULTS,
                    "description": format!(
                        "Cap on returned disallowed paths (default {DEFAULT_MAX_RESULTS}). \
                         meta.truncated reports whether any were dropped."
                    ),
                },
            },
            "required": ["content", "path"],
            "additionalProperties": false,
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const CASES: &str = include_str!("../../fixtures/mcp-analyze-robots.json");

    fn body(file: &str) -> &'static str {
        match file {
            "simple.txt" => include_str!("../../fixtures/robots/simple.txt"),
            "disallow-all.txt" => include_str!("../../fixtures/robots/disallow-all.txt"),
            "wildcards.txt" => include_str!("../../fixtures/robots/wildcards.txt"),
            "multi-group.txt" => include_str!("../../fixtures/robots/multi-group.txt"),
            "agent-specific.txt" => include_str!("../../fixtures/robots/agent-specific.txt"),
            other => panic!("fixture body {other} not embedded — add it here"),
        }
    }

    /// The shared corpus, run against this implementation. The same
    /// file runs against the extension's in
    /// `scripts/check-signature-parity.ts`, which is what makes the
    /// two servers the same tool rather than two similar ones.
    #[test]
    fn every_shared_case_reproduces() {
        let cases: Value = serde_json::from_str(CASES).expect("fixture JSON");
        for case in cases.as_array().expect("array of cases") {
            let name = case["name"].as_str().expect("name");
            let mut arguments = case["arguments"].clone();
            if let Some(file) = case["file"].as_str() {
                arguments["content"] = json!(body(file));
            }

            if case["expected"].is_object() {
                let actual = analyze(&arguments)
                    .unwrap_or_else(|error| panic!("case {name:?} failed: {error}"));
                assert_eq!(actual, case["expected"], "case {name:?}");
                continue;
            }
            let error = analyze(&arguments).expect_err(&format!("case {name:?} must fail"));
            assert_eq!(
                error,
                case["expectedError"].as_str().expect("expectedError"),
                "case {name:?}"
            );
        }
    }

    #[test]
    fn an_excessive_cap_is_clamped_not_rejected() {
        let arguments = json!({
            "content": "User-agent: *\nDisallow: /a\n",
            "path": "/b",
            "maxResults": 999_999,
        });
        let result = analyze(&arguments).expect("clamped, not rejected");
        assert_eq!(result["meta"]["truncated"], false);
    }

    #[test]
    fn truncation_is_reported_rather_than_hidden() {
        use std::fmt::Write as _;
        let mut content = String::from("User-agent: *\n");
        for i in 0..10 {
            let _ = writeln!(content, "Disallow: /p{i}");
        }
        let arguments = json!({ "content": content, "path": "/x", "maxResults": 3 });
        let result = analyze(&arguments).expect("runs");
        assert_eq!(result["meta"]["truncated"], true);
        assert_eq!(result["meta"]["count"], 3);
        assert_eq!(
            result["data"]["disallowedPaths"]
                .as_array()
                .expect("array")
                .len(),
            3
        );
    }

    #[test]
    fn the_schema_matches_the_published_tool() {
        let definition = definition();
        assert_eq!(definition["name"], "analyze_robots_txt");
        assert_eq!(
            definition["inputSchema"]["required"],
            json!(["content", "path"])
        );
        assert_eq!(definition["inputSchema"]["additionalProperties"], false);
        assert_eq!(
            definition["inputSchema"]["properties"]["maxResults"]["default"],
            500
        );
        assert_eq!(
            definition["inputSchema"]["properties"]["maxResults"]["maximum"],
            5000
        );
    }
}
