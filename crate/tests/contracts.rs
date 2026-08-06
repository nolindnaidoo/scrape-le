//! The exit codes are the API — a caller programs against "0 means
//! yes, 1 means a real no, 2 means the question was malformed" — so
//! they are pinned by tests that drive the built binary against a
//! local fixture server. No display, no browser, no internet, so they
//! run anywhere on every push.

use std::fmt::Write as _;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::process::{Command, Stdio};
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
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = listener.local_addr().expect("addr").port();
    thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(stream) = stream else { continue };
            thread::spawn(move || serve_one(stream));
        }
    });
    port
}

fn serve_one(mut stream: TcpStream) {
    let mut reader = BufReader::new(stream.try_clone().expect("clone"));
    let mut request_line = String::new();
    if reader.read_line(&mut request_line).is_err() {
        return;
    }
    let path = request_line.split_whitespace().nth(1).unwrap_or("/");

    let route = ROUTES.iter().find(|route| route.path == path);
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
    let mcp_report = &response["result"]["structuredContent"]["data"];

    assert_eq!(cli_report["verdict"], mcp_report["verdict"]);
    assert_eq!(cli_report["findings"], mcp_report["findings"]);
    assert_eq!(cli_report["checks"], mcp_report["checks"]);
    assert_eq!(response["result"]["structuredContent"]["ok"], false);
}
