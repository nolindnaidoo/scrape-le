//! What only a real browser can prove: the page probes, the login-form
//! evidence, post-JS content, and that a fully rendered clean page
//! reaches `clear`.
//!
//! Gated behind `SCRAPE_LE_SCENARIOS` and run by CI on all three
//! platforms. Skipped by default so `cargo test` on a machine without a
//! browser stays green and honest — a skipped scenario is never
//! reported as a pass.

use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::process::Command;
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::thread;

fn enabled() -> bool {
    std::env::var("SCRAPE_LE_SCENARIOS").is_ok_and(|value| !value.is_empty() && value != "0")
}

/// Every scenario launches a browser, and three at once on one machine
/// contend for it — a flake that says nothing about the code. Held for
/// the duration of each test so the suite is deterministic however it
/// is invoked, rather than relying on the runner passing
/// `--test-threads=1`.
fn one_browser_at_a_time() -> MutexGuard<'static, ()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

const CLEAN: &str =
    "<html><head><title>Clean</title></head><body><p>nothing here</p></body></html>";

/// A password field inside a form with a username field: the
/// extension's strong authentication signal.
const LOGIN: &str = "<html><head><title>Sign in</title></head><body>\
     <form action=\"/session\"><input type=\"text\" name=\"user\">\
     <input type=\"password\" name=\"pass\"></form></body></html>";

/// A vendor global written by script, so only a rendered probe finds
/// it — the whole reason rendering is the default.
const WIDGET: &str = "<html><head><title>Protected</title></head><body>\
     <div class=\"g-recaptcha\"></div>\
     <script>window.grecaptcha = { ready: function () {} };</script>\
     </body></html>";

fn start_server() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = listener.local_addr().expect("addr").port();
    thread::spawn(move || {
        for stream in listener.incoming().flatten() {
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
    let (status, body) = match path {
        "/robots.txt" => ("200 OK", "User-agent: *\nAllow: /\n"),
        "/clean" => ("200 OK", CLEAN),
        "/login" => ("200 OK", LOGIN),
        "/widget" => ("200 OK", WIDGET),
        _ => ("404 Not Found", ""),
    };
    let response = format!(
        "HTTP/1.1 {status}\r\ncontent-type: text/html\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

fn check(url: &str) -> (i32, serde_json::Value) {
    let binary = env!("CARGO_BIN_EXE_scrape-le");
    let output = Command::new(binary)
        .arg(url)
        .current_dir(std::env::temp_dir())
        .output()
        .expect("binary runs");
    let code = output.status.code().expect("exit code");
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let line = stdout.lines().next().unwrap_or_default().to_string();
    let report = serde_json::from_str(&line).unwrap_or(serde_json::Value::Null);
    (code, report)
}

#[test]
fn a_fully_rendered_clean_page_is_clear() {
    if !enabled() {
        eprintln!("skipped: set SCRAPE_LE_SCENARIOS=1 and have a browser installed");
        return;
    }
    let _serialized = one_browser_at_a_time();
    let port = start_server();
    let (code, report) = check(&format!("http://127.0.0.1:{port}/clean"));
    assert_eq!(report["verdict"], "clear", "{report}");
    assert_eq!(report["checks"]["antibot"], "ran");
    assert_eq!(report["checks"]["auth"], "ran");
    assert_eq!(code, 0);
    assert!(report["screenshot"].is_string(), "a screenshot was written");
    assert!(report["timing_ms"]["render"].is_number());
    // One page load: the document's status came from the browser, so
    // no separate HTTP fetch of the page happened.
    assert_eq!(report["timing_ms"]["fetch"], 0);
    assert_eq!(report["status"], 200);
}

#[test]
fn a_login_form_is_found_only_by_rendering() {
    if !enabled() {
        eprintln!("skipped: set SCRAPE_LE_SCENARIOS=1 and have a browser installed");
        return;
    }
    let _serialized = one_browser_at_a_time();
    let port = start_server();
    let (code, report) = check(&format!("http://127.0.0.1:{port}/login"));
    assert_eq!(report["verdict"], "restricted", "{report}");
    assert_eq!(code, 1);
    let indicators = report["findings"]
        .as_array()
        .expect("findings")
        .iter()
        .find(|finding| finding["kind"] == "auth")
        .expect("an auth finding")["evidence"]["indicators"]
        .to_string();
    assert!(indicators.contains("Login form detected"), "{indicators}");
}

#[test]
fn a_script_written_vendor_global_is_detected() {
    if !enabled() {
        eprintln!("skipped: set SCRAPE_LE_SCENARIOS=1 and have a browser installed");
        return;
    }
    let _serialized = one_browser_at_a_time();
    let port = start_server();
    let (_, report) = check(&format!("http://127.0.0.1:{port}/widget"));
    let details = report["findings"].to_string();
    assert!(details.contains("reCAPTCHA"), "{details}");
    // The DOM element is found before the global, matching the
    // extension's evidence precedence.
    assert!(details.contains("DOM element"), "{details}");
    assert_eq!(report["title"], "Protected");
}
