//! The exit codes are the API — a caller programs against "0 means
//! yes, 1 means a real no, 2 means the question was malformed" — so
//! they are pinned by tests that drive the built binary against a
//! local fixture server. No display, no browser, no internet, so they
//! run anywhere on every push.

use std::fmt::Write as _;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::thread;

/// A response the fixture server should give for a path.
struct Route {
    path: &'static str,
    status: &'static str,
    headers: &'static [(&'static str, &'static str)],
    body: &'static str,
}

const ROUTES: &[Route] = &[
    Route {
        path: "/robots.txt",
        status: "200 OK",
        headers: &[("content-type", "text/plain")],
        body: "User-agent: *\nDisallow: /forbidden\nCrawl-delay: 0\n\nUser-agent: PickyBot\nDisallow: /\n",
    },
    Route {
        path: "/open",
        status: "200 OK",
        headers: &[("content-type", "text/html")],
        body: "<html><head><title>Open</title></head><body>hello</body></html>",
    },
    Route {
        path: "/forbidden",
        status: "200 OK",
        headers: &[("content-type", "text/html")],
        body: "<html><head><title>Forbidden by robots</title></head><body>hi</body></html>",
    },
    Route {
        path: "/limited",
        status: "429 Too Many Requests",
        headers: &[("retry-after", "60"), ("x-ratelimit-limit", "100")],
        body: "slow down",
    },
    Route {
        path: "/secret",
        status: "401 Unauthorized",
        headers: &[("content-type", "text/html")],
        body: "<html><head><title>Members</title></head><body>no</body></html>",
    },
    Route {
        path: "/cloudflare",
        status: "200 OK",
        headers: &[("cf-ray", "8abc123-EWR"), ("content-type", "text/html")],
        body: "<html><head><title>Fronted</title></head><body>hi</body></html>",
    },
];

/// Serves the routes above until the process ends. Bound to port 0 so
/// concurrent test binaries never collide.
fn start_server() -> u16 {
    start_counting_server(0).0
}

/// The same server, plus the number of `/robots.txt` requests it has
/// been sent and an optional run of leading failures on that one route.
///
/// Counting is how "one robots.txt per origin" is asserted: the win is a
/// request that no longer happens, and a count says that exactly, where
/// a duration would mostly measure whichever machine is running the
/// suite. `fail_first` closes the connection without writing a response,
/// which is what a dropped or refused one looks like from the client.
fn start_counting_server(fail_first: usize) -> (u16, Arc<AtomicUsize>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = listener.local_addr().expect("addr").port();
    let robots_requests = Arc::new(AtomicUsize::new(0));
    let counter = Arc::clone(&robots_requests);
    thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(stream) = stream else { continue };
            let counter = Arc::clone(&counter);
            thread::spawn(move || serve_one(stream, &counter, fail_first));
        }
    });
    (port, robots_requests)
}

fn serve_one(mut stream: TcpStream, robots_requests: &AtomicUsize, fail_first: usize) {
    let mut reader = BufReader::new(stream.try_clone().expect("clone"));
    let mut request_line = String::new();
    if reader.read_line(&mut request_line).is_err() {
        return;
    }
    let path = request_line.split_whitespace().nth(1).unwrap_or("/");

    if path == "/robots.txt" && robots_requests.fetch_add(1, Ordering::SeqCst) < fail_first {
        return;
    }

    // `/page/<n>` is any number of distinct, unremarkable pages on one
    // host — what a batch of fifty URLs on one site actually looks like,
    // which no fixed route table can supply. They answer as `/open`.
    let wanted = if path.starts_with("/page/") {
        "/open"
    } else {
        path
    };
    let route = ROUTES.iter().find(|route| route.path == wanted);
    let response = match route {
        Some(route) => {
            let mut head = format!("HTTP/1.1 {}\r\n", route.status);
            for (name, value) in route.headers {
                let _ = write!(head, "{name}: {value}\r\n");
            }
            let _ = write!(head, "content-length: {}\r\n", route.body.len());
            head.push_str("connection: close\r\n\r\n");
            format!("{head}{}", route.body)
        }
        None => {
            "HTTP/1.1 404 Not Found\r\ncontent-length: 0\r\nconnection: close\r\n\r\n".to_string()
        }
    };
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

struct Run {
    code: i32,
    stdout: String,
}

/// Runs the built binary. `--no-render` throughout: these tests pin the
/// exit-code contract, which must hold on a machine with no browser.
fn run(args: &[&str]) -> Run {
    let binary = env!("CARGO_BIN_EXE_scrape-le");
    let mut command = Command::new(binary);
    command.arg("--no-render");
    command.args(args);
    let output = command.output().expect("binary runs");
    Run {
        code: output.status.code().expect("exit code"),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
    }
}

fn verdict_of(stdout: &str) -> String {
    let line = stdout.lines().next().unwrap_or_default();
    let report: serde_json::Value = serde_json::from_str(line).expect("a JSON report");
    report["verdict"].as_str().unwrap_or_default().to_string()
}

#[test]
fn a_clean_page_without_render_is_inconclusive_and_exits_1() {
    let port = start_server();
    let run = run(&[&format!("http://127.0.0.1:{port}/open")]);
    // Never `clear`: the anti-bot and auth checks cannot complete
    // without a rendered page, and `clear` is a claim about absence.
    assert_eq!(verdict_of(&run.stdout), "inconclusive");
    assert_eq!(run.code, 1);
}

#[test]
fn a_robots_disallow_is_restricted_and_exits_1() {
    let port = start_server();
    let run = run(&[&format!("http://127.0.0.1:{port}/forbidden")]);
    assert_eq!(verdict_of(&run.stdout), "restricted");
    assert_eq!(run.code, 1);
    assert!(run.stdout.contains("Disallow: /forbidden"));
}

#[test]
fn an_agent_specific_group_only_applies_when_asked_for() {
    let port = start_server();
    let url = format!("http://127.0.0.1:{port}/open");

    let generic = run(&[&url]);
    assert_eq!(verdict_of(&generic.stdout), "inconclusive");

    let picky = run(&["--agent", "PickyBot/1.0", &url]);
    assert_eq!(verdict_of(&picky.stdout), "restricted");
    assert!(picky.stdout.contains("User-agent: pickybot"));
    assert_eq!(picky.code, 1);
}

#[test]
fn http_429_is_restricted_and_exits_1() {
    let port = start_server();
    let run = run(&[&format!("http://127.0.0.1:{port}/limited")]);
    assert_eq!(verdict_of(&run.stdout), "restricted");
    assert_eq!(run.code, 1);
    assert!(run.stdout.contains("rate limited right now"));
}

#[test]
fn http_401_is_restricted_and_exits_1() {
    let port = start_server();
    let run = run(&[&format!("http://127.0.0.1:{port}/secret")]);
    assert_eq!(verdict_of(&run.stdout), "restricted");
    assert_eq!(run.code, 1);
    assert!(run.stdout.contains("HTTP 401 Unauthorized"));
}

#[test]
fn a_vendor_header_warns_and_names_its_evidence() {
    let port = start_server();
    let run = run(&[&format!("http://127.0.0.1:{port}/cloudflare")]);
    assert_eq!(verdict_of(&run.stdout), "restricted");
    assert!(run.stdout.contains("Cloudflare (cf-ray header)"));
    assert!(run.stdout.contains("response-header"));
}

#[test]
fn an_unparseable_url_exits_2() {
    let run = run(&["not a url at all"]);
    assert_eq!(run.code, 2);
}

#[test]
fn a_dns_failure_exits_2() {
    let run = run(&["https://this-host-does-not-exist-9f2c1a.invalid/"]);
    assert_eq!(run.code, 2);
}

#[test]
fn an_unknown_flag_exits_2() {
    let run = run(&["--not-a-flag", "https://example.com"]);
    assert_eq!(run.code, 2);
}

#[test]
fn a_flag_missing_its_value_exits_2() {
    let run = run(&["--agent"]);
    assert_eq!(run.code, 2);
}

#[test]
fn help_and_version_exit_0() {
    for flag in ["--help", "--version"] {
        let run = run(&[flag]);
        assert_eq!(run.code, 0, "{flag}");
        assert!(!run.stdout.is_empty(), "{flag}");
    }
}

#[test]
fn a_batch_exits_with_its_worst_verdict() {
    let port = start_server();
    let directory = std::env::temp_dir().join(format!("scrape-le-contract-{port}"));
    std::fs::create_dir_all(&directory).expect("temp dir");
    let input = directory.join("urls.txt");
    std::fs::write(
        &input,
        format!("http://127.0.0.1:{port}/open\nhttp://127.0.0.1:{port}/forbidden\n"),
    )
    .expect("write input");

    let run = run(&["--input", input.to_str().expect("path")]);
    assert_eq!(run.code, 1);
    let verdicts: Vec<String> = run.stdout.lines().map(verdict_of).collect();
    assert_eq!(verdicts.len(), 2);
    assert!(verdicts.contains(&"restricted".to_string()));

    std::fs::remove_dir_all(&directory).ok();
}

#[test]
fn a_batch_reports_every_input_index() {
    let port = start_server();
    let directory = std::env::temp_dir().join(format!("scrape-le-index-{port}"));
    std::fs::create_dir_all(&directory).expect("temp dir");
    let input = directory.join("urls.json");
    std::fs::write(
        &input,
        format!(
            r#"["http://127.0.0.1:{port}/open","http://127.0.0.1:{port}/limited","http://127.0.0.1:{port}/open"]"#
        ),
    )
    .expect("write input");

    let run = run(&["--input", input.to_str().expect("path")]);
    let mut indices: Vec<u64> = run
        .stdout
        .lines()
        .map(|line| {
            let report: serde_json::Value = serde_json::from_str(line).expect("JSON");
            report["index"].as_u64().expect("index")
        })
        .collect();
    indices.sort_unstable();
    assert_eq!(indices, [0, 1, 2]);

    std::fs::remove_dir_all(&directory).ok();
}

/// Writes a batch input file and returns its path plus the directory to
/// clean up.
fn batch_input(port: u16, name: &str, urls: &[String]) -> (std::path::PathBuf, std::path::PathBuf) {
    let directory = std::env::temp_dir().join(format!("scrape-le-{name}-{port}"));
    std::fs::create_dir_all(&directory).expect("temp dir");
    let input = directory.join("urls.txt");
    std::fs::write(&input, urls.join("\n")).expect("write input");
    (input, directory)
}

/// **What grouping by host was always for.** Twenty paths on one origin
/// is one robots.txt request, not twenty — and the twenty answers are
/// the ones each path had when each fetched and parsed its own copy.
#[test]
fn a_batch_asks_one_origin_for_robots_txt_once() {
    let (port, robots_requests) = start_counting_server(0);
    let mut urls: Vec<String> = (0..19)
        .map(|i| format!("http://127.0.0.1:{port}/page/{i}"))
        .collect();
    urls.push(format!("http://127.0.0.1:{port}/forbidden"));
    let (input, directory) = batch_input(port, "cache", &urls);

    let run = run(&["--input", input.to_str().expect("path")]);

    assert_eq!(
        robots_requests.load(Ordering::SeqCst),
        1,
        "20 URLs on one origin asked for robots.txt more than once"
    );
    let verdicts: Vec<String> = run.stdout.lines().map(verdict_of).collect();
    assert_eq!(verdicts.len(), 20);
    assert_eq!(
        verdicts.iter().filter(|v| *v == "inconclusive").count(),
        19,
        "every unremarkable page answers as it does alone: {verdicts:?}"
    );
    assert_eq!(
        verdicts.iter().filter(|v| *v == "restricted").count(),
        1,
        "the disallowed path is still disallowed: {verdicts:?}"
    );
    assert!(run.stdout.contains("Disallow: /forbidden"));
    assert_eq!(run.code, 1);

    std::fs::remove_dir_all(&directory).ok();
}

/// **Regression.** A robots.txt that fails to arrive must not answer for
/// the rest of the run. The cache holds what an origin served, never a
/// failure to serve it, so the next URL on that host asks again — and
/// the rules that come back are the ones that decide. Caching the miss
/// would have had one dropped connection read as "nothing forbids you"
/// for every remaining URL on the host, which is the single direction
/// this tool may not be wrong in.
#[test]
fn a_failed_robots_txt_does_not_answer_for_the_rest_of_the_run() {
    let (port, robots_requests) = start_counting_server(1);
    let urls = [
        format!("http://127.0.0.1:{port}/page/0"),
        format!("http://127.0.0.1:{port}/forbidden"),
    ];
    let (input, directory) = batch_input(port, "retry", &urls);

    let run = run(&["--input", input.to_str().expect("path")]);

    // URLs on one host run in input order, so the first request is the
    // one that fails and the second is the retry.
    assert_eq!(robots_requests.load(Ordering::SeqCst), 2);
    let verdicts: Vec<String> = run.stdout.lines().map(verdict_of).collect();
    assert!(
        verdicts.contains(&"restricted".to_string()),
        "the retry's rules never reached the second URL: {verdicts:?}"
    );
    assert!(run.stdout.contains("Disallow: /forbidden"));

    std::fs::remove_dir_all(&directory).ok();
}

/// **Regression.** `--ignore-crawl-delay` worked and left no trace: a
/// three-URL batch on one host dropped from 4.02s to 0.00s, and the
/// reports were byte-identical apart from `timing_ms`. README, SPEC and
/// `--help` all promise the report records that the flag was used, so
/// the output cannot misrepresent how it was obtained.
#[test]
fn ignoring_the_crawl_delay_is_recorded_in_every_report() {
    let port = start_server();
    let urls = [
        format!("http://127.0.0.1:{port}/open"),
        format!("http://127.0.0.1:{port}/forbidden"),
    ];
    let (input, directory) = batch_input(port, "delay", &urls);
    let path = input.to_str().expect("path");

    let honoured = run(&["--input", path]);
    let ignored = run(&["--input", path, "--ignore-crawl-delay"]);

    for line in honoured.stdout.lines() {
        let report: serde_json::Value = serde_json::from_str(line).expect("JSON");
        assert_eq!(
            report["crawl_delay_ignored"], false,
            "a polite run claimed the delay was skipped: {line}"
        );
    }
    for line in ignored.stdout.lines() {
        let report: serde_json::Value = serde_json::from_str(line).expect("JSON");
        assert_eq!(
            report["crawl_delay_ignored"], true,
            "the flag left no trace in the report: {line}"
        );
    }

    // And a single URL, which shares the projection but not the batch.
    let single = run(&[&urls[0], "--ignore-crawl-delay"]);
    let report: serde_json::Value =
        serde_json::from_str(single.stdout.lines().next().expect("a report")).expect("JSON");
    assert_eq!(report["crawl_delay_ignored"], true);

    std::fs::remove_dir_all(&directory).ok();
}

/// The CLI and the MCP server must answer the same URL identically —
/// asserted directly, so neither surface can drift from the other.
#[test]
fn the_two_surfaces_return_identical_findings() {
    let port = start_server();
    let url = format!("http://127.0.0.1:{port}/forbidden");

    let cli = run(&[&url]);
    let cli_report: serde_json::Value =
        serde_json::from_str(cli.stdout.lines().next().expect("a report")).expect("JSON");

    let request = format!(
        r#"{{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{{"name":"scrape_le_check","arguments":{{"url":"{url}","render":false}}}}}}"#
    );
    let binary = env!("CARGO_BIN_EXE_scrape-le");
    let mut child = Command::new(binary)
        .arg("mcp")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .expect("mcp starts");
    child
        .stdin
        .as_mut()
        .expect("stdin")
        .write_all(format!("{request}\n").as_bytes())
        .expect("write request");
    drop(child.stdin.take());
    let mut raw = String::new();
    child
        .stdout
        .as_mut()
        .expect("stdout")
        .read_to_string(&mut raw)
        .expect("read response");
    child.wait().expect("mcp exits");

    let response: serde_json::Value =
        serde_json::from_str(raw.lines().next().expect("a response")).expect("JSON");
    let envelope = &response["result"]["structuredContent"];
    let mcp_report = &envelope["data"];

    assert_eq!(cli_report["verdict"], mcp_report["verdict"]);
    assert_eq!(cli_report["findings"], mcp_report["findings"]);
    assert_eq!(cli_report["checks"], mcp_report["checks"]);
    // `ok` says the check ran; the answer is the verdict. A restricted
    // page must not read as a broken tool.
    assert_eq!(envelope["ok"], true);
    assert_eq!(mcp_report["verdict"], "restricted");
    assert_eq!(response["result"]["isError"], false);
}
