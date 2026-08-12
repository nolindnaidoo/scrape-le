//! A standing net over the robots.txt parser and the URL validator.
//!
//! Time-boxed, not run to convergence: the point is that a panic, a
//! hang, or a slice off a character boundary has somewhere to be caught,
//! not that the input space is proved. Sixty seconds in CI, a second
//! locally.
//!
//! **It never reaches the network.** `analyze_robots_txt` is the tool
//! that takes a robots.txt body the caller already has — deliberately,
//! because fetching an arbitrary origin inside an agent loop would be an
//! SSRF primitive — so every case here is `detect/robots.rs` and
//! `detect/url.rs` and nothing else. The `path` argument routes through
//! `normalize_url` and `validate_url` whenever it carries a scheme,
//! which is how the validator is reached from the same seam.
//!
//! Robots matching is RFC 9309: longest match wins, `*` is any run of
//! characters, a trailing `$` anchors the end. Every one of those is a
//! regex built at match time from attacker-supplied text, which makes
//! pathological input a real risk and a hang a real bug — so the
//! generator writes patterns nobody would write by hand, and every case
//! has a deadline.
//!
//! The checked-in robots corpus is the seed set.

use std::fmt::Write as _;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{Receiver, RecvTimeoutError, channel};
use std::time::{Duration, Instant};

const BINARY: &str = env!("CARGO_BIN_EXE_scrape-le");

/// Seconds of fuzzing. CI passes 60; a bare `cargo test` runs one, so
/// the net is present on every push without owning the run.
fn budget() -> Duration {
    let seconds = std::env::var("SCRAPE_LE_FUZZ_SECONDS")
        .ok()
        .and_then(|raw| raw.parse::<u64>().ok())
        .unwrap_or(1);
    Duration::from_secs(seconds)
}

/// Printed on every run, failing or not: a fuzz failure nobody can
/// reproduce is a fuzz failure nobody fixes.
fn seed() -> u64 {
    std::env::var("SCRAPE_LE_FUZZ_SEED")
        .ok()
        .and_then(|raw| raw.parse::<u64>().ok())
        .unwrap_or(0x5c2a_be1e_0b1d_2026)
}

/// One case may not take longer than this. A matcher that goes
/// exponential on a pattern of wildcards would otherwise be a CI job
/// that never ends.
const CASE_LIMIT: Duration = Duration::from_secs(20);

/// The corpus, as seeds.
const SEEDS: [(&str, &str); 5] = [
    ("simple.txt", include_str!("../fixtures/robots/simple.txt")),
    (
        "disallow-all.txt",
        include_str!("../fixtures/robots/disallow-all.txt"),
    ),
    (
        "wildcards.txt",
        include_str!("../fixtures/robots/wildcards.txt"),
    ),
    (
        "multi-group.txt",
        include_str!("../fixtures/robots/multi-group.txt"),
    ),
    (
        "agent-specific.txt",
        include_str!("../fixtures/robots/agent-specific.txt"),
    ),
];

/// xorshift64*, four lines and identical on every platform. A fuzz run
/// needs to be reproducible, not statistically excellent.
struct Seeded(u64);

impl Seeded {
    fn next(&mut self) -> u64 {
        let mut state = self.0;
        state ^= state >> 12;
        state ^= state << 25;
        state ^= state >> 27;
        self.0 = state;
        state.wrapping_mul(0x2545_f491_4f6c_dd1d)
    }

    fn below(&mut self, limit: usize) -> usize {
        let limit = u64::try_from(limit).unwrap_or(1).max(1);
        usize::try_from(self.next() % limit).unwrap_or(0)
    }

    fn pick<'a, T>(&mut self, from: &'a [T]) -> &'a T {
        &from[self.below(from.len())]
    }
}

/// A server held open across the whole run: spawning a process per case
/// would measure `fork`, not the parser.
struct Server {
    child: Child,
    stdin: ChildStdin,
    lines: Receiver<Option<String>>,
}

impl Server {
    fn start() -> Self {
        let mut child = Command::new(BINARY)
            .arg("mcp")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("the server starts");
        let stdin = child.stdin.take().expect("stdin");
        let stdout = child.stdout.take().expect("stdout");

        // Read on a thread so a case that never answers is a timeout
        // naming its body rather than a blocked test.
        let (sender, lines) = channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                if sender.send(line.ok()).is_err() {
                    return;
                }
            }
            let _ = sender.send(None);
        });

        Self {
            child,
            stdin,
            lines,
        }
    }

    fn call(&mut self, case: &str, arguments: &serde_json::Value) -> String {
        let request = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": { "name": "analyze_robots_txt", "arguments": arguments },
        });
        writeln!(self.stdin, "{request}")
            .unwrap_or_else(|error| panic!("{case}: the server stopped reading ({error})"));
        self.stdin
            .flush()
            .unwrap_or_else(|error| panic!("{case}: could not flush ({error})"));

        match self.lines.recv_timeout(CASE_LIMIT) {
            Ok(Some(line)) => line,
            Ok(None) => panic!("{case}: the server died — a panic, or a slice off a boundary"),
            Err(RecvTimeoutError::Timeout) => {
                panic!("{case}: no answer in {CASE_LIMIT:?} — the matcher is not terminating")
            }
            Err(RecvTimeoutError::Disconnected) => panic!("{case}: the server closed stdout"),
        }
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

const AGENTS: [&str; 6] = ["*", "googlebot", "MyBot", "  *  ", "", "Bot/1.0"];

/// Patterns nobody writes by hand, which is the point: every one of them
/// becomes a regex at match time.
fn pattern(seeded: &mut Seeded) -> String {
    match seeded.below(12) {
        0 => "/".to_string(),
        1 => format!("/{}", "a".repeat(1 + seeded.below(200))),
        2 => format!("/{}$", "b".repeat(1 + seeded.below(50))),
        3 => "*".repeat(1 + seeded.below(200)),
        4 => format!("/{}", "*a".repeat(1 + seeded.below(60))),
        5 => format!("/{}$", "*".repeat(1 + seeded.below(60))),
        6 => "/\u{e9}\u{1f389}/\u{4e2d}\u{6587}".to_string(),
        7 => "$".to_string(),
        8 => format!("/search?q={}", "%20".repeat(1 + seeded.below(20))),
        9 => "/[a-z]+(x|y)*\\d".to_string(),
        10 => format!("/{}", "\u{e9}".repeat(1 + seeded.below(40))),
        _ => format!("/path-{}", seeded.below(1000)),
    }
}

fn body(seeded: &mut Seeded) -> String {
    let mut out = String::new();
    if seeded.below(8) == 0 {
        out.push('\u{feff}');
    }
    let newline = if seeded.below(4) == 0 { "\r\n" } else { "\n" };
    let groups = 1 + seeded.below(4);

    for _ in 0..groups {
        for _ in 0..=seeded.below(3) {
            let _ = write!(out, "User-agent: {}{newline}", seeded.pick(&AGENTS));
        }
        for _ in 0..=seeded.below(12) {
            match seeded.below(8) {
                0 => {
                    let _ = write!(out, "Allow: {}{newline}", pattern(seeded));
                }
                1 => {
                    let _ = write!(out, "# a comment{newline}");
                }
                2 => {
                    out.push_str(newline);
                }
                3 => {
                    let delay = *seeded.pick(&[
                        "10", "0", "-1", "1.5", "1e3", "Infinity", "infinity", "nan", "abc", "",
                        "10s", "0x10", "+5", ".5",
                    ]);
                    let _ = write!(out, "Crawl-delay: {delay}{newline}");
                }
                4 => {
                    let _ = write!(
                        out,
                        "Sitemap: https://example.com/sitemap-{}.xml{newline}",
                        seeded.below(100)
                    );
                }
                5 => {
                    // a directive with no colon, and one with nothing after it
                    let _ = write!(out, "Disallow{newline}Allow:{newline}");
                }
                6 => {
                    let _ = write!(out, "DiSaLlOw: {}{newline}", pattern(seeded));
                }
                _ => {
                    let _ = write!(out, "Disallow: {}{newline}", pattern(seeded));
                }
            }
        }
    }

    if seeded.below(2) == 0 {
        while out.ends_with('\n') || out.ends_with('\r') {
            out.pop();
        }
    }
    out
}

/// The `path` argument. Anything carrying `://` routes through
/// `normalize_url` and `validate_url`, which is how the URL validator is
/// reached without a network.
fn target(seeded: &mut Seeded) -> String {
    match seeded.below(12) {
        0 => "/".to_string(),
        1 => format!("/path-{}", seeded.below(1000)),
        2 => "https://example.com/admin/secret".to_string(),
        3 => "http://user:pw@example.com:8080/a/b?c=1#d".to_string(),
        4 => "://not a scheme".to_string(),
        5 => "ftp://example.com/x".to_string(),
        6 => "admin".to_string(),
        7 => format!("/{}", "long/".repeat(1 + seeded.below(200))),
        8 => "/\u{e9}\u{1f389}".to_string(),
        9 => "https://[::1]:99999/x".to_string(),
        10 => String::new(),
        _ => format!("/search?q={}", seeded.below(1000)),
    }
}

fn check(case: &str, body: &str, target: &str, raw: &str) {
    let response: serde_json::Value = serde_json::from_str(raw)
        .unwrap_or_else(|error| panic!("{case}: the answer is not JSON ({error}) — {raw}"));
    assert!(
        response.get("error").is_none(),
        "{case}: the tool call failed — {raw}\nbody:\n{body}\npath: {target:?}"
    );
    let envelope = &response["result"]["structuredContent"];
    assert_eq!(
        envelope["meta"]["tool"], "analyze_robots_txt",
        "{case}: not the tool's envelope — {raw}"
    );

    let data = &envelope["data"];
    let path = data["path"]
        .as_str()
        .unwrap_or_else(|| panic!("{case}: no path in the answer — {raw}"));
    assert!(
        path.starts_with('/'),
        "{case}: rules match a path, and {path:?} is not one — a full URL that was \
         not reduced silently matches no Disallow at all\nbody:\n{body}\npath: {target:?}"
    );
    assert!(
        data["allowsCrawling"].is_boolean(),
        "{case}: the verdict is not a boolean — {raw}"
    );

    let disallowed = data["disallowedPaths"]
        .as_array()
        .unwrap_or_else(|| panic!("{case}: disallowedPaths is not a list — {raw}"));
    for entry in disallowed {
        let pattern = entry
            .as_str()
            .unwrap_or_else(|| panic!("{case}: a disallowed path is not a string — {raw}"));
        assert!(
            body.contains(pattern),
            "{case}: {pattern:?} was reported but is not in the document\nbody:\n{body}"
        );
    }
}

#[test]
fn robots_parsing_survives_the_corpus_and_what_grows_out_of_it() {
    let seed = seed();
    let budget = budget();
    eprintln!("fuzz: seed {seed:#x}, budget {budget:?}");

    let mut server = Server::start();
    let mut seeded = Seeded(seed);
    let mut cases = 0usize;

    // The checked-in corpus first: the documents both frontends already
    // agree about are the seeds everything else grows from.
    for (name, document) in SEEDS {
        for path in ["/", "/admin/secret", "https://example.com/private/x"] {
            let case = format!("seed corpus {name} {path}");
            let raw = server.call(
                &case,
                &serde_json::json!({ "content": document, "path": path }),
            );
            check(&case, document, path, &raw);
            cases += 1;
        }
    }

    let deadline = Instant::now() + budget;
    while Instant::now() < deadline {
        let document = body(&mut seeded);
        let path = target(&mut seeded);
        let case = format!("seed {seed:#x} case {cases}");
        let raw = server.call(
            &case,
            &serde_json::json!({ "content": document, "path": path }),
        );
        check(&case, &document, &path, &raw);
        cases += 1;
    }

    eprintln!("fuzz: {cases} documents, seed {seed:#x}");
    assert!(cases > SEEDS.len(), "the fuzzer ran no generated documents");
}

/// The pathological shapes by name, outside the random path, so a
/// failure says what broke rather than which seed found it.
#[test]
fn pathological_patterns_terminate() {
    let mut server = Server::start();
    let cases: [(&str, String); 5] = [
        (
            "two hundred wildcards",
            format!("User-agent: *\nDisallow: /{}\n", "*a".repeat(200)),
        ),
        (
            "a wildcard run with an anchor",
            format!("User-agent: *\nDisallow: {}$\n", "*".repeat(500)),
        ),
        (
            "a very long literal",
            format!("User-agent: *\nDisallow: /{}\n", "a".repeat(50_000)),
        ),
        (
            "ten thousand rules",
            (0..10_000).fold(String::from("User-agent: *\n"), |mut out, index| {
                let _ = writeln!(out, "Disallow: /path-{index}/*");
                out
            }),
        ),
        (
            "regex metacharacters as literals",
            "User-agent: *\nDisallow: /(a|b)+[c-z]{2,}\\d*\n".to_string(),
        ),
    ];

    for (name, document) in cases {
        let started = Instant::now();
        let raw = server.call(
            name,
            &serde_json::json!({
                "content": document,
                "path": "/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab",
            }),
        );
        check(name, &document, "/aaaa…b", &raw);
        eprintln!("fuzz: {name} answered in {:?}", started.elapsed());
    }
}
