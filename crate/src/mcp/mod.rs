//! The agent surface: the same `check()` over the Model Context
//! Protocol on stdio, so a model can ask the question instead of being
//! handed a page and guessing.
//!
//! Three rules the family's MCP surfaces established:
//!
//! - **A negative answer is not an error.** `restricted` and
//!   `inconclusive` come back as ordinary results carrying
//!   `ok: false`. Only a malformed question is a protocol error. A
//!   model that reads a refusal as a broken tool retries instead of
//!   reacting.
//! - **Refusals speak the caller's vocabulary.** An MCP caller has no
//!   command line, so no message here mentions a flag.
//! - **A malformed frame is answered in the npm server's words.** Three
//!   servers ship from this repository, and a client cannot be allowed to
//!   tell them apart by what it sent: the same frame limit, the same
//!   parse errors, the same reading of a null id and of an unknown
//!   method or tool. `scripts/check-cli-pipes.ts` feeds both binaries the
//!   malformed frames and compares the replies.
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

/// The most bytes one frame may hold before it is refused.
///
/// Input with no newline was held whole: a 16 MiB line was read and
/// answered, and a client streaming without one grew the process without
/// bound. The same figure and message as the npm server's, so a caller
/// diffing the two finds nothing.
pub(crate) const MAX_FRAME_BYTES: usize = 16 * 1024 * 1024;

/// JSON-RPC error codes, from the spec.
const PARSE_ERROR: i64 = -32700;
const INVALID_PARAMS: i64 = -32602;
const METHOD_NOT_FOUND: i64 = -32601;

pub(crate) fn serve() -> ExitCode {
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    serve_streams(stdin.lock(), stdout.lock())
}

/// The stdio loop over any pair of streams, so a test can drive it with
/// bytes.
///
/// Reads newline-delimited JSON. A line that is not UTF-8 is read with
/// replacement characters, as the npm server's decoder reads it. A line
/// that is not JSON, or not a request, is answered with a parse error in
/// the npm server's words rather than dropped, so a client that sent one
/// learns what happened; before, the line vanished without a word.
pub(crate) fn serve_streams(mut input: impl BufRead, mut output: impl Write) -> ExitCode {
    let mut frame: Vec<u8> = Vec::new();
    // Set once a frame has passed the limit: the rest of that line is
    // dropped as it arrives, so the oversized message is never held.
    let mut discarding = false;
    loop {
        let (consumed, complete) = {
            let Ok(chunk) = input.fill_buf() else {
                return ExitCode::from(2);
            };
            if chunk.is_empty() {
                break;
            }
            let newline = chunk.iter().position(|&byte| byte == b'\n');
            if !discarding {
                frame.extend_from_slice(&chunk[..newline.unwrap_or(chunk.len())]);
            }
            (newline.map_or(chunk.len(), |at| at + 1), newline.is_some())
        };
        input.consume(consumed);
        if discarding {
            discarding = !complete;
            continue;
        }
        if !complete {
            if frame.len() > MAX_FRAME_BYTES {
                frame = Vec::new();
                discarding = true;
                if emit(&mut output, &frame_refusal()).is_err() {
                    return ExitCode::from(2);
                }
            }
            continue;
        }
        let line = std::mem::take(&mut frame);
        if line.len() > MAX_FRAME_BYTES {
            // The newline arrived in the chunk that took the frame over the
            // limit, so the check above never saw it. The limit is on the
            // line, not on when its end happened to arrive.
            if emit(&mut output, &frame_refusal()).is_err() {
                return ExitCode::from(2);
            }
            continue;
        }
        let Some(response) = respond_to_line(&line) else {
            continue;
        };
        if emit(&mut output, &response).is_err() {
            return ExitCode::from(2);
        }
    }
    // A partial frame at close was never a request; the npm server drops
    // it the same way.
    ExitCode::SUCCESS
}

/// One line in, at most one reply out: the same refusals, in the same
/// words, as the npm server's loop.
fn respond_to_line(line: &[u8]) -> Option<Value> {
    let text = String::from_utf8_lossy(line);
    let text = text.trim();
    if text.is_empty() {
        return None;
    }
    let Ok(request) = serde_json::from_str::<Value>(text) else {
        return Some(parse_error("Invalid JSON"));
    };
    if !is_request(&request) {
        return Some(parse_error("Not a JSON-RPC 2.0 request"));
    }
    handle(&request)
}

fn emit(output: &mut impl Write, message: &Value) -> std::io::Result<()> {
    writeln!(output, "{message}")?;
    output.flush()
}

fn is_request(value: &Value) -> bool {
    value.get("jsonrpc").and_then(Value::as_str) == Some("2.0")
        && value.get("method").is_some_and(Value::is_string)
}

fn frame_refusal() -> Value {
    parse_error(&format!(
        "Message exceeds the {MAX_FRAME_BYTES} byte frame limit"
    ))
}

fn parse_error(message: &str) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": null,
        "error": { "code": PARSE_ERROR, "message": message },
    })
}

fn handle(request: &Value) -> Option<Value> {
    let method = request.get("method")?.as_str()?;
    // A notification carries no id, or a null one, and takes no reply; the
    // npm server reads both the same way, and this answered the null one.
    let id = request.get("id").filter(|id| !id.is_null()).cloned()?;

    let result = match method {
        "initialize" => Ok(json!({
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": { "tools": {} },
            "serverInfo": { "name": "scrape-le", "version": env!("CARGO_PKG_VERSION") },
        })),
        "tools/list" => Ok(json!({ "tools": tool_definitions() })),
        "tools/call" => call_tool(request.get("params")),
        "ping" => Ok(json!({})),
        other => Err((METHOD_NOT_FOUND, format!("Unknown method: {other}"))),
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
    let no_name = || {
        (
            INVALID_PARAMS,
            "tools/call requires a string `name`".to_string(),
        )
    };
    let params = params.ok_or_else(no_name)?;
    let name = params
        .get("name")
        .and_then(Value::as_str)
        .ok_or_else(no_name)?;
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
        other => Err((INVALID_PARAMS, format!("Unknown tool: {other}"))),
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

    // The run is this call. A `urls` list of many paths on one host
    // costs one robots.txt; a second call an hour later fetches afresh,
    // because this server outlives any answer it is safe to keep.
    let robots = crate::fetch::RobotsCache::new();

    let mut reports = Vec::with_capacity(urls.len());
    for (index, raw) in urls.iter().enumerate() {
        let Some(url) = crate::detect::url::target_url(raw) else {
            // The caller asked something unanswerable. That is a
            // tool-level failure it can fix, not the server breaking.
            return tool_failure(&format!("{raw} is not an http or https URL"));
        };
        let position = (urls.len() > 1).then_some(index);
        match check_url(&url, position, &options, &robots) {
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

/// An entry of the wrong shape is named, never dropped. `["…", 7]` used
/// to check one URL and report `count: 1` with nothing said about the
/// other, and `url: 7` was answered "no URL was supplied" — one was.
fn requested_urls(arguments: &Value) -> Result<Vec<String>, String> {
    match arguments.get("url") {
        Some(Value::String(url)) => return Ok(vec![url.clone()]),
        Some(_) => return Err("url must be a string".to_string()),
        None => {}
    }
    match arguments.get("urls") {
        Some(Value::Array(items)) => {
            let mut urls = Vec::with_capacity(items.len());
            for (index, item) in items.iter().enumerate() {
                let Some(url) = item.as_str() else {
                    return Err(format!("entry {index} of urls is not a string"));
                };
                urls.push(url.to_string());
            }
            if urls.is_empty() {
                return Err("the list of URLs was empty".to_string());
            }
            Ok(urls)
        }
        Some(_) => Err("urls must be a list of strings".to_string()),
        None => Err("no URL was supplied to check".to_string()),
    }
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
        let null_id = json!({ "jsonrpc": "2.0", "id": null, "method": "ping" });
        assert!(handle(&null_id).is_none(), "a null id is a notification");
    }

    /// The loop, driven with bytes in the 8 KiB chunks stdin arrives in,
    /// with what it wrote and how it ended.
    fn drive(input: &[u8]) -> (String, Vec<Value>) {
        let mut written = Vec::new();
        let reader = std::io::BufReader::with_capacity(8192, std::io::Cursor::new(input.to_vec()));
        let code = serve_streams(reader, &mut written);
        let replies = String::from_utf8(written)
            .expect("replies are UTF-8")
            .lines()
            .map(|line| serde_json::from_str(line).expect("a reply is JSON"))
            .collect();
        (format!("{code:?}"), replies)
    }

    const PING: &[u8] = b"{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}\n";

    /// A line of invalid bytes was dropped without a word; it is a parse
    /// error now, and the ping after it is still answered.
    #[test]
    fn an_invalid_utf8_line_is_a_parse_error_and_the_server_reads_on() {
        let (code, replies) = drive(&[b"\xff\xfe\n".as_slice(), PING].concat());
        assert_eq!(code, format!("{:?}", ExitCode::SUCCESS));
        assert_eq!(replies[0], parse_error("Invalid JSON"));
        assert_eq!(replies[1]["id"], 1);
    }

    /// Inside a string the npm server's decoder replaces the byte and the
    /// request succeeds; this reads it the same way, where it dropped it.
    #[test]
    fn an_invalid_byte_inside_a_string_is_replaced_as_the_npm_server_reads_it() {
        let request = [
            br#"{"jsonrpc":"2.0","id":2,"method":"ping","x":"caf"#.as_slice(),
            b"\xe9",
            br#""}"#,
            b"\n",
        ]
        .concat();
        let (_, replies) = drive(&request);
        assert_eq!(replies[0]["id"], 2);
        assert_eq!(replies[0]["result"], json!({}));
    }

    /// A frame that is not JSON used to be dropped without a word.
    #[test]
    fn a_line_that_is_not_json_is_answered_with_a_parse_error() {
        let (_, replies) = drive(&[b"not json at all\n".as_slice(), PING].concat());
        assert_eq!(replies[0], parse_error("Invalid JSON"));
        assert_eq!(replies[1]["id"], 1);
    }

    /// A request without a method was dropped, and one without `jsonrpc`
    /// or with another version was answered; the npm server refuses all
    /// three the same way. A byte order mark is not whitespace to either
    /// parser, so a frame led by one is not JSON.
    #[test]
    fn a_line_that_is_not_a_request_is_answered_with_a_parse_error() {
        for line in [
            br#"{"id":1}"#.as_slice(),
            br#"{"id":1,"method":"ping"}"#,
            br#"{"jsonrpc":"1.0","id":1,"method":"ping"}"#,
            br#"{"jsonrpc":"2.0","id":1,"method":7}"#,
            b"[1,2,3]",
            b"5",
        ] {
            let (_, replies) = drive(&[line, b"\n"].concat());
            assert_eq!(
                replies[0],
                parse_error("Not a JSON-RPC 2.0 request"),
                "{line:?}"
            );
        }
        let (_, replies) = drive(&[b"\xef\xbb\xbf".as_slice(), PING].concat());
        assert_eq!(replies[0], parse_error("Invalid JSON"));
    }

    /// Input with no newline was held whole. Past the limit the frame is
    /// refused in the npm server's words, the rest of the line is dropped
    /// as it arrives, and the next line is served.
    #[test]
    fn a_frame_over_the_limit_is_refused_and_the_next_line_served() {
        // One byte over, with the newline in the chunk that takes the frame
        // over the limit; and far over, with the newline many chunks later.
        for over in [1, 100_000] {
            let mut input = vec![b'x'; MAX_FRAME_BYTES + over];
            input.extend_from_slice(b"\n");
            input.extend_from_slice(PING);
            let (code, replies) = drive(&input);
            assert_eq!(code, format!("{:?}", ExitCode::SUCCESS));
            assert_eq!(replies[0], frame_refusal(), "{over} over");
            assert_eq!(replies[1]["id"], 1, "{over} over");
            assert_eq!(replies.len(), 2, "{over} over");
        }
    }

    /// Exactly at the limit is served; the limit is a ceiling, not a size.
    #[test]
    fn a_frame_at_the_limit_is_served() {
        let mut input = br#"{"jsonrpc":"2.0","id":1,"method":"ping","params":{"pad":""#.to_vec();
        let padding = MAX_FRAME_BYTES - input.len() - 3;
        input.extend(std::iter::repeat_n(b'x', padding));
        input.extend_from_slice(b"\"}}\n");
        assert_eq!(
            input.len(),
            MAX_FRAME_BYTES + 1,
            "the line plus its newline"
        );
        let (_, replies) = drive(&input);
        assert_eq!(replies[0]["id"], 1);
    }

    /// A last line with no newline was answered; it is a partial frame at
    /// close, which the npm server drops too.
    #[test]
    fn blank_lines_and_a_partial_frame_at_close_are_ignored() {
        let (code, replies) = drive(
            &[
                b"\n\r\n \t\n".as_slice(),
                PING,
                b"{\"jsonrpc\":\"2.0\",\"id\":9,\"method\":\"ping\"}",
            ]
            .concat(),
        );
        assert_eq!(code, format!("{:?}", ExitCode::SUCCESS));
        assert_eq!(replies.len(), 1);
        assert_eq!(replies[0]["id"], 1);
    }

    /// The refusals a client can provoke read the same from every server
    /// this repository ships.
    #[test]
    fn protocol_refusals_use_the_npm_servers_words() {
        let response = handle(&request("does/not/exist", &json!({}))).expect("a reply");
        assert_eq!(
            response["error"]["message"],
            "Unknown method: does/not/exist"
        );
        let response = handle(&request(
            "tools/call",
            &json!({ "name": "scrape_le_extract", "arguments": {} }),
        ))
        .expect("a reply");
        assert_eq!(
            response["error"]["message"],
            "Unknown tool: scrape_le_extract"
        );
        for params in [json!({}), json!([1]), json!({ "name": 3 })] {
            let response = handle(&request("tools/call", &params)).expect("a reply");
            assert_eq!(
                response["error"]["message"], "tools/call requires a string `name`",
                "{params}"
            );
        }
        let response =
            handle(&json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call" })).expect("a reply");
        assert_eq!(
            response["error"]["message"],
            "tools/call requires a string `name`"
        );
        let initialized =
            json!({ "jsonrpc": "2.0", "id": 1, "method": "notifications/initialized" });
        assert_eq!(
            handle(&initialized).expect("a reply")["error"]["code"],
            METHOD_NOT_FOUND,
            "a notification sent with an id is a method this server does not implement"
        );
    }

    /// The handshake answers with this server's own revision and bare tool
    /// support, as the extension's server answers, whatever the client asked.
    #[test]
    fn initialize_does_not_echo_the_clients_version() {
        let asked = request("initialize", &json!({ "protocolVersion": "1999-01-01" }));
        let response = handle(&asked).expect("a reply");
        assert_eq!(response["result"]["protocolVersion"], PROTOCOL_VERSION);
        assert_eq!(response["result"]["capabilities"], json!({ "tools": {} }));
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

    /// An entry of the wrong shape was dropped: `["…", 7]` checked one URL
    /// and reported `count: 1` with nothing said about the other.
    #[test]
    fn a_wrong_shaped_url_entry_is_named_not_dropped() {
        for (arguments, message) in [
            (json!({ "url": 7 }), "url must be a string"),
            (
                json!({ "urls": ["https://example.com", 7] }),
                "entry 1 of urls is not a string",
            ),
            (json!({ "urls": [null] }), "entry 0 of urls is not a string"),
            (
                json!({ "urls": "https://example.com" }),
                "urls must be a list of strings",
            ),
            (json!({ "urls": [] }), "the list of URLs was empty"),
        ] {
            let response = handle(&request(
                "tools/call",
                &json!({ "name": "scrape_le_check", "arguments": arguments }),
            ))
            .expect("a reply");
            assert_eq!(response["result"]["isError"], true, "{arguments}");
            assert_eq!(
                response["result"]["content"][0]["text"], message,
                "{arguments}"
            );
        }
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
