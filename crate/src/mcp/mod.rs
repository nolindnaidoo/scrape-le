//! The agent surface: the same `check()` over the Model Context
//! Protocol on stdio, so a model can ask the question instead of being
//! handed a page and guessing.
//!
//! Two rules the other tools' MCP surfaces established:
//!
//! - **A negative answer is not an error.** `restricted` and
//!   `inconclusive` come back as ordinary results carrying
//!   `ok: false`. Only a malformed question is a protocol error. A
//!   model that reads a refusal as a broken tool retries instead of
//!   reacting.
//! - **Refusals speak the caller's vocabulary.** An MCP caller has no
//!   command line, so no message here mentions a flag.
//!
//! Read-only by construction: there is no acting surface, so unlike
//! pixelactions there is no consent gate to design — the worst this can
//! do is fetch a page.

mod analyze;

use std::io::{BufRead, Write};
use std::process::ExitCode;

use serde_json::{Value, json};

use crate::check_url::{CheckOutcome, check_url};
use crate::cli::Options;

const PROTOCOL_VERSION: &str = "2025-06-18";

/// JSON-RPC error codes, from the spec.
const INVALID_PARAMS: i64 = -32602;
const METHOD_NOT_FOUND: i64 = -32601;

pub(crate) fn serve() -> ExitCode {
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    for line in stdin.lock().lines() {
        let Ok(line) = line else {
            return ExitCode::from(2);
        };
        if line.trim().is_empty() {
            continue;
        }
        let Ok(request) = serde_json::from_str::<Value>(&line) else {
            // A frame that is not JSON has no id to answer against;
            // dropping it is the only honest option.
            continue;
        };
        let Some(response) = handle(&request) else {
            continue; // a notification: no reply
        };
        if writeln!(stdout, "{response}").is_err() || stdout.flush().is_err() {
            return ExitCode::from(2);
        }
    }
    ExitCode::SUCCESS
}

fn handle(request: &Value) -> Option<Value> {
    let id = request.get("id").cloned();
    let method = request.get("method")?.as_str()?;
    // Notifications carry no id and get no reply.
    id.as_ref()?;

    let result = match method {
        "initialize" => Ok(json!({
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": { "tools": {} },
            "serverInfo": { "name": "scrape-le", "version": env!("CARGO_PKG_VERSION") },
        })),
        "tools/list" => Ok(json!({ "tools": tool_definitions() })),
        "tools/call" => call_tool(request.get("params")),
        "ping" => Ok(json!({})),
        other => Err((
            METHOD_NOT_FOUND,
            format!("this server does not implement {other}"),
        )),
    };

    Some(match result {
        Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
        Err((code, message)) => json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": { "code": code, "message": message },
        }),
    })
}

fn tool_definitions() -> Value {
    json!([
        analyze::definition(),
        {
            "name": "scrape_le_check",
            "description": "Check whether a page can be scraped: robots.txt, anti-bot vendors, \
                            rate limits and authentication walls. Accepts one URL or several. \
                            A restricted or inconclusive answer is a normal result, not an error.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "url": { "type": "string", "description": "the URL to check" },
                    "urls": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "several URLs to check, instead of `url`",
                    },
                    "render": {
                        "type": "boolean",
                        "description": "load the page in a browser (default true). Without it, \
                                        anti-bot and authentication checks run partially and the \
                                        verdict can never be `clear`.",
                    },
                    "agent": {
                        "type": "string",
                        "description": "evaluate robots.txt as this crawler token; the generic \
                                        rules are used when omitted",
                    },
                },
            },
        },
        {
            "name": "scrape_le_doctor",
            "description": "Report whether a browser is available, which one, and which checks \
                            can run completely.",
            "inputSchema": { "type": "object", "properties": {} },
        },
    ])
}

/// Protocol failures (no tool named, an unknown tool) are JSON-RPC
/// errors; a tool that fails on its arguments returns a result carrying
/// `isError`, so a model reads the reason and reacts rather than
/// concluding the server is broken. Same rule as the npm server.
fn call_tool(params: Option<&Value>) -> Result<Value, (i64, String)> {
    let params = params.ok_or((INVALID_PARAMS, "no tool call was supplied".to_string()))?;
    let name = params
        .get("name")
        .and_then(Value::as_str)
        .ok_or((INVALID_PARAMS, "the tool call named no tool".to_string()))?;
    let arguments = params
        .get("arguments")
        .cloned()
        .unwrap_or_else(|| json!({}));

    match name {
        "analyze_robots_txt" => Ok(match analyze::analyze(&arguments) {
            Ok(result) => tool_result(&result),
            Err(message) => tool_failure(&message),
        }),
        "scrape_le_check" => Ok(check_tool(&arguments)),
        "scrape_le_doctor" => Ok(doctor_tool()),
        other => Err((
            INVALID_PARAMS,
            format!("this server offers no tool named {other}"),
        )),
    }
}

fn check_tool(arguments: &Value) -> Value {
    let urls = match requested_urls(arguments) {
        Ok(urls) => urls,
        Err(message) => return tool_failure(&message),
    };
    let options = Options {
        no_render: !arguments
            .get("render")
            .and_then(Value::as_bool)
            .unwrap_or(true),
        agent: arguments
            .get("agent")
            .and_then(Value::as_str)
            .map(str::to_string),
        concurrency: crate::batch::DEFAULT_CONCURRENCY,
        ignore_crawl_delay: false,
    };

    let mut reports = Vec::with_capacity(urls.len());
    for (index, raw) in urls.iter().enumerate() {
        let url = crate::detect::url::normalize_url(raw);
        if !crate::detect::url::validate_url(&url) {
            // The caller asked something unanswerable. That is a
            // tool-level failure it can fix, not the server breaking.
            return tool_failure(&format!("{raw} is not an http or https URL"));
        }
        let position = (urls.len() > 1).then_some(index);
        match check_url(&url, position, &options) {
            CheckOutcome::Report(report) => {
                reports.push(serde_json::to_value(&report).expect("report serializes"));
            }
            CheckOutcome::Malformed(reason) => return tool_failure(&reason),
        }
    }

    let count = reports.len();
    let payload = if count == 1 {
        reports.remove(0)
    } else {
        json!({ "reports": reports })
    };
    // A partial run is worth saying out loud: the verdict is capped at
    // `inconclusive` and the caller should know why before acting on it.
    let diagnostics = if options.no_render {
        vec![warning(
            "render",
            "the page was not loaded in a browser, so the anti-bot and authentication \
             checks ran partially and the verdict cannot be `clear`",
        )]
    } else {
        Vec::new()
    };
    tool_result(&envelope("scrape_le_check", &payload, count, &diagnostics))
}

fn requested_urls(arguments: &Value) -> Result<Vec<String>, String> {
    if let Some(url) = arguments.get("url").and_then(Value::as_str) {
        return Ok(vec![url.to_string()]);
    }
    if let Some(items) = arguments.get("urls").and_then(Value::as_array) {
        let urls: Vec<String> = items
            .iter()
            .filter_map(|item| item.as_str().map(str::to_string))
            .collect();
        if urls.is_empty() {
            return Err("the list of URLs was empty".to_string());
        }
        return Ok(urls);
    }
    Err("no URL was supplied to check".to_string())
}

fn doctor_tool() -> Value {
    let (payload, diagnostics) = match crate::render::find_browser() {
        Ok(path) => (
            json!({
                "browser": path.to_string_lossy(),
                "render": "available",
                "checks_complete": true,
                "detail": "every check can run, so a `clear` verdict is reachable",
            }),
            Vec::new(),
        ),
        Err(reason) => (
            json!({
                "browser": Value::Null,
                "render": "unavailable",
                "checks_complete": false,
                "detail": format!(
                    "{reason}. robots.txt, status, headers and redirects still answer, but \
                     anti-bot and authentication run partially and the verdict can never be clear"
                ),
            }),
            // A warning, not an error: doctor answered the question it
            // was asked. What it found is that rendering is missing.
            vec![warning("render", &reason)],
        ),
    };
    tool_result(&envelope("scrape_le_doctor", &payload, 1, &diagnostics))
}

/// The one result shape every tool returns, matching the npm server's
/// envelope field for field: `{ ok, data, diagnostics, meta }`.
///
/// **`ok` reports whether the check ran, not whether the answer is
/// yes.** A page that is `restricted` is the answer, not a failure to
/// produce one — conflating the two would have a model report a broken
/// tool when what it actually learned is that it should not scrape.
/// The verdict lives in `data`.
fn envelope(tool: &str, data: &Value, count: usize, diagnostics: &[Value]) -> Value {
    let ok = !diagnostics
        .iter()
        .any(|d| d["severity"].as_str() == Some("error"));
    json!({
        "ok": ok,
        "data": data,
        "diagnostics": diagnostics,
        "meta": { "tool": tool, "count": count, "truncated": false },
    })
}

/// An MCP tool result: the envelope as text (what a model reads) and
/// the same envelope structured. Identical to what the npm server
/// emits, so a caller diffing the two servers finds nothing.
fn tool_result(envelope: &Value) -> Value {
    let text = serde_json::to_string_pretty(envelope).expect("envelope serializes");
    json!({
        "content": [{ "type": "text", "text": text }],
        "structuredContent": envelope,
        "isError": false,
    })
}

fn warning(code: &str, message: &str) -> Value {
    json!({ "severity": "warning", "code": code, "message": message })
}

/// The tool could not run on the arguments given. `isError` so a model
/// reads the message and corrects itself.
fn tool_failure(message: &str) -> Value {
    json!({
        "content": [{ "type": "text", "text": message }],
        "isError": true,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(method: &str, params: &Value) -> Value {
        json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params })
    }

    #[test]
    fn initialize_answers_with_the_protocol_version() {
        let response = handle(&request("initialize", &json!({}))).expect("a reply");
        assert_eq!(response["result"]["protocolVersion"], PROTOCOL_VERSION);
        assert_eq!(response["result"]["serverInfo"]["name"], "scrape-le");
    }

    #[test]
    fn tools_list_offers_both_tools() {
        let response = handle(&request("tools/list", &json!({}))).expect("a reply");
        let tools = response["result"]["tools"].as_array().expect("tools");
        let names: Vec<&str> = tools.iter().filter_map(|t| t["name"].as_str()).collect();
        assert_eq!(
            names,
            ["analyze_robots_txt", "scrape_le_check", "scrape_le_doctor"]
        );
    }

    #[test]
    fn a_notification_gets_no_reply() {
        let notification = json!({ "jsonrpc": "2.0", "method": "initialized" });
        assert!(handle(&notification).is_none());
    }

    #[test]
    fn an_unknown_method_is_a_protocol_error() {
        let response = handle(&request("does/not/exist", &json!({}))).expect("a reply");
        assert_eq!(response["error"]["code"], METHOD_NOT_FOUND);
    }

    /// A bad argument is the tool failing on what it was given, not
    /// the server breaking — so it comes back as a result carrying
    /// isError, the same rule the npm server follows.
    #[test]
    fn a_malformed_url_is_a_tool_failure_not_a_protocol_error() {
        let response = handle(&request(
            "tools/call",
            &json!({ "name": "scrape_le_check", "arguments": { "url": "not a url" } }),
        ))
        .expect("a reply");
        assert!(response.get("error").is_none(), "{response}");
        assert_eq!(response["result"]["isError"], true);
        assert!(
            response["result"]["content"][0]["text"]
                .as_str()
                .expect("a message")
                .contains("not an http or https URL")
        );
    }

    #[test]
    fn a_missing_url_is_a_tool_failure() {
        let response = handle(&request(
            "tools/call",
            &json!({ "name": "scrape_le_check", "arguments": {} }),
        ))
        .expect("a reply");
        assert_eq!(response["result"]["isError"], true);
    }

    #[test]
    fn the_shared_tool_is_offered_and_answers() {
        let response = handle(&request(
            "tools/call",
            &json!({
                "name": "analyze_robots_txt",
                "arguments": {
                    "content": "User-agent: *\nDisallow: /admin\n",
                    "path": "/admin/x",
                },
            }),
        ))
        .expect("a reply");
        let envelope = &response["result"]["structuredContent"];
        assert_eq!(envelope["meta"]["tool"], "analyze_robots_txt");
        assert_eq!(envelope["data"]["allowsCrawling"], false);
        assert_eq!(envelope["ok"], true, "the analysis ran");
        assert_eq!(response["result"]["isError"], false);
    }

    /// This tool reaches no network — that is the property that lets an
    /// agent call it anywhere, and it must not regress.
    #[test]
    fn the_shared_tool_needs_no_network() {
        let before = std::time::Instant::now();
        let response = handle(&request(
            "tools/call",
            &json!({
                "name": "analyze_robots_txt",
                "arguments": { "content": "User-agent: *\nAllow: /\n", "path": "/" },
            }),
        ))
        .expect("a reply");
        assert_eq!(response["result"]["isError"], false);
        // A network round trip could not complete this fast; the tool
        // works purely from the content it was handed.
        assert!(before.elapsed() < std::time::Duration::from_millis(200));
    }

    #[test]
    fn an_unknown_tool_is_a_protocol_error() {
        let response = handle(&request(
            "tools/call",
            &json!({ "name": "scrape_le_extract", "arguments": {} }),
        ))
        .expect("a reply");
        assert_eq!(response["error"]["code"], INVALID_PARAMS);
    }

    /// Refusals speak the caller's vocabulary: an MCP caller has no
    /// command line, so no message may name a flag.
    #[test]
    fn no_message_mentions_a_command_line_flag() {
        let doctor = doctor_tool();
        let rendered = serde_json::to_string(&doctor).expect("serializes");
        assert!(!rendered.contains("--"), "{rendered}");

        let definitions = serde_json::to_string(&tool_definitions()).expect("serializes");
        assert!(!definitions.contains("--"), "{definitions}");
    }

    #[test]
    fn doctor_reports_a_structured_answer() {
        let doctor = doctor_tool();
        assert!(doctor["structuredContent"]["data"]["render"].is_string());
        assert_eq!(
            doctor["structuredContent"]["meta"]["tool"],
            "scrape_le_doctor"
        );
        // `ok` means doctor answered, not that a browser was found —
        // a missing browser is reported as a warning diagnostic.
        assert_eq!(doctor["structuredContent"]["ok"], true);
        assert_eq!(doctor["isError"], false);
    }

    /// Every tool returns the same envelope, so a caller writes one
    /// reader for all of them and for both servers.
    #[test]
    fn every_tool_returns_the_same_envelope_shape() {
        let results = [
            doctor_tool(),
            match analyze::analyze(&json!({ "content": "User-agent: *\n", "path": "/" })) {
                Ok(result) => tool_result(&result),
                Err(message) => panic!("{message}"),
            },
        ];
        for result in results {
            let envelope = &result["structuredContent"];
            assert!(envelope["ok"].is_boolean(), "{envelope}");
            assert!(!envelope["data"].is_null(), "{envelope}");
            assert!(envelope["diagnostics"].is_array(), "{envelope}");
            assert!(envelope["meta"]["tool"].is_string(), "{envelope}");
            assert!(envelope["meta"]["count"].is_number(), "{envelope}");
            assert!(envelope["meta"]["truncated"].is_boolean(), "{envelope}");
        }
    }
}
