//! A wall-clock ceiling, and two shape checks on how the clock moves.
//!
//! A sibling crate was fifty times slower than the rest of the family
//! for a whole release and nothing noticed, because nothing measured it.
//! The ceiling here is deliberately loose — a shared runner is not a
//! benchmark rig — and exists to catch an order of magnitude, not a
//! percent.
//!
//! Two linearity assertions, because robots.txt grows in two directions
//! and only one of them is the obvious one:
//!
//! - **four times the documents** must not cost six times the clock;
//! - **four times the rules in one document** must not either. That is
//!   the shape a sibling missed — an unterminated heredoc re-read the
//!   rest of the file once per queued tag, and five thousand tags took
//!   twenty-five seconds. Every robots.txt rule becomes a regex, and
//!   longest-match-wins reads all of them.
//!
//! **No network.** The bodies are generated and fed to
//! `analyze_robots_txt`, the tool that takes a robots.txt the caller
//! already has.
//!
//! Gated behind `SCRAPE_LE_BUDGET` and run by CI on one platform with
//! `--test-threads=1`; a timing assertion measured against six other
//! tests on the same cores is noise. A skipped run says so by name.

use std::fmt::Write as _;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::time::{Duration, Instant};

const BINARY: &str = env!("CARGO_BIN_EXE_scrape-le");

/// The corpus: 500 robots.txt bodies, generated from a fixed seed rather
/// than checked in — 500 near-identical text files in git would be 500 a
/// reviewer has to ignore — and from a **fixed** seed, so two runs
/// measure the same corpus.
const SEED: u64 = 0x5c2a_be1e_0b1d_2026;
const DOCUMENTS: usize = 500;

/// **10× the local measurement**, recorded with the machine it came
/// from: 1.14 s for the 500-document corpus on an Apple M-series laptop,
/// debug build, 2026-08. Ten times that leaves a shared runner room to be
/// several times slower and still be right; it does not leave room for an
/// order of magnitude, which is the thing worth catching.
const BUDGET: Duration = Duration::from_millis(11_400);

/// Four times the work, at most six times the clock.
const LINEARITY: f64 = 6.0;

fn enabled(name: &str) -> bool {
    if std::env::var_os("SCRAPE_LE_BUDGET").is_some() {
        return true;
    }
    eprintln!("SKIPPED {name}: set SCRAPE_LE_BUDGET to run it");
    false
}

/// xorshift64*, four lines and identical on every platform.
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
}

struct Server {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<std::process::ChildStdout>,
}

impl Server {
    fn start() -> Self {
        let mut child = Command::new(BINARY)
            .arg("mcp")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("the server starts");
        let stdin = child.stdin.take().expect("stdin");
        let stdout = BufReader::new(child.stdout.take().expect("stdout"));
        Self {
            child,
            stdin,
            stdout,
        }
    }

    fn analyze(&mut self, content: &str, path: &str) {
        let request = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": "analyze_robots_txt",
                "arguments": { "content": content, "path": path },
            },
        });
        writeln!(self.stdin, "{request}").expect("the server reads");
        self.stdin.flush().expect("flushed");
        let mut line = String::new();
        let read = self
            .stdout
            .read_line(&mut line)
            .expect("the server answers");
        assert!(read > 0, "the server closed stdout mid-run");
        assert!(
            line.contains("\"analyze_robots_txt\""),
            "the measured call failed: {line}"
        );
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// One robots.txt of roughly the shape a large site serves: a generic
/// group, an agent-specific group, wildcards, an anchor, a crawl-delay
/// and a sitemap.
fn document(seeded: &mut Seeded, rules: usize) -> String {
    let mut out = String::from("User-agent: *\nCrawl-delay: 2\n");
    for index in 0..rules {
        let _ = match index % 4 {
            0 => writeln!(out, "Disallow: /section-{}/private", seeded.below(1000)),
            1 => writeln!(out, "Disallow: /*/tmp-{}/*", seeded.below(1000)),
            2 => writeln!(out, "Allow: /section-{}/private/public", seeded.below(1000)),
            _ => writeln!(out, "Disallow: /assets-{}.json$", seeded.below(1000)),
        };
    }
    out.push_str("Sitemap: https://example.com/sitemap.xml\n");
    out.push_str("User-agent: googlebot\nDisallow: /nothing-here\n");
    out
}

/// The fastest of three runs. The fastest, not the mean: a shared runner
/// pauses for reasons that have nothing to do with this code, and the
/// question is what the work costs, not what the neighbours cost.
fn fastest(documents: usize, rules: usize) -> Duration {
    let mut seeded = Seeded(SEED);
    let corpus: Vec<String> = (0..documents)
        .map(|_| document(&mut seeded, rules))
        .collect();

    let mut best = Duration::MAX;
    for _ in 0..3 {
        let mut server = Server::start();
        let started = Instant::now();
        for (index, body) in corpus.iter().enumerate() {
            server.analyze(body, &format!("/section-{index}/private/thing"));
        }
        best = best.min(started.elapsed());
    }
    best
}

#[test]
fn five_hundred_robots_documents_parse_inside_their_budget() {
    if !enabled("five_hundred_robots_documents_parse_inside_their_budget") {
        return;
    }
    let elapsed = fastest(DOCUMENTS, 20);
    eprintln!("budget: {DOCUMENTS} documents in {elapsed:?} (ceiling {BUDGET:?}, seed {SEED:#x})");
    assert!(
        elapsed <= BUDGET,
        "{DOCUMENTS} documents took {elapsed:?}, over the {BUDGET:?} ceiling (seed {SEED:#x})"
    );
}

#[test]
fn four_times_the_documents_is_not_six_times_the_clock() {
    if !enabled("four_times_the_documents_is_not_six_times_the_clock") {
        return;
    }
    let one = fastest(DOCUMENTS, 20);
    let four = fastest(DOCUMENTS * 4, 20);
    let ratio = four.as_secs_f64() / one.as_secs_f64().max(f64::EPSILON);
    eprintln!(
        "budget: {one:?} for {DOCUMENTS}, {four:?} for {}, ratio {ratio:.2}",
        DOCUMENTS * 4
    );
    assert!(
        ratio <= LINEARITY,
        "four times the corpus cost {ratio:.2}× the time (limit {LINEARITY}×), seed {SEED:#x}"
    );
}

/// The one a sibling missed. Longest-match-wins reads every rule, and
/// every rule becomes a regex; anything that re-reads the document per
/// rule shows up here and nowhere else.
#[test]
fn four_times_the_rules_in_one_document_is_not_six_times_the_clock() {
    if !enabled("four_times_the_rules_in_one_document_is_not_six_times_the_clock") {
        return;
    }
    let one = fastest(20, 500);
    let four = fastest(20, 2_000);
    let ratio = four.as_secs_f64() / one.as_secs_f64().max(f64::EPSILON);
    eprintln!("budget: {one:?} for 500 rules, {four:?} for 2000, ratio {ratio:.2}");
    assert!(
        ratio <= LINEARITY,
        "four times the rules cost {ratio:.2}× the time (limit {LINEARITY}×), seed {SEED:#x}"
    );
}
