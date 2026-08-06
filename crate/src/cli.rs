//! The terminal surface. stdout is always protocol (one JSON report),
//! stderr is always for the human — a projection of the same report,
//! never parallel prose. Exit codes are the API: 0 `clear`, 1 not a
//! yes, 2 the question was malformed.

use std::process::ExitCode;

use crate::detect::check::{Evidence, check};
use crate::detect::report::{CheckStatus, Report, Severity, Verdict};
use crate::detect::url::{normalize_url, validate_url};
use crate::fetch::{FetchError, fetch_evidence};

const USAGE: &str = "usage: scrape-le [--no-render] <url>
       scrape-le --version | --help

Checks whether a page is scrapeable and reports what would block a
scraper: robots.txt, anti-bot vendors, rate limits, auth walls.
JSON report on stdout, human summary on stderr.

Rendering is the default and drives a browser you already have (Chrome,
Chromium, Brave, Edge — or set CHROME). --no-render skips the browser;
the verdict can then never be `clear`, and the report says so.

Exit codes: 0 clear · 1 restricted/blocked/inconclusive · 2 malformed question.";

pub(crate) fn run() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut no_render = false;
    let mut urls: Vec<&str> = Vec::new();
    for arg in &args {
        match arg.as_str() {
            "--no-render" => no_render = true,
            "--help" | "-h" => {
                println!("{USAGE}");
                return ExitCode::SUCCESS;
            }
            "--version" | "-V" => {
                println!("scrape-le {}", env!("CARGO_PKG_VERSION"));
                return ExitCode::SUCCESS;
            }
            flag if flag.starts_with('-') => {
                eprintln!("scrape-le: unknown flag {flag}\n\n{USAGE}");
                return ExitCode::from(2);
            }
            url => urls.push(url),
        }
    }
    match urls.as_slice() {
        [] => {
            eprintln!("{USAGE}");
            ExitCode::from(2)
        }
        [url] => check_one(url, no_render),
        _ => {
            eprintln!("scrape-le: one URL per run for now — batch --input is not implemented yet");
            ExitCode::from(2)
        }
    }
}

fn check_one(raw: &str, no_render: bool) -> ExitCode {
    let started = std::time::Instant::now();
    let url = normalize_url(raw);
    if !validate_url(&url) {
        eprintln!("scrape-le: not an http(s) URL: {raw}");
        return ExitCode::from(2);
    }

    // The rendered path loads the page once, in the browser, and takes
    // its status and headers from the document's CDP response — asking
    // whether a site may be scraped must not cost that site two hits.
    // Only robots.txt is fetched alongside it.
    let mut evidence: Evidence = match render_evidence(&url, no_render) {
        Some(evidence) => evidence,
        None => match fetch_evidence(&url) {
            Ok(evidence) => evidence,
            Err(FetchError::Malformed(reason)) => {
                eprintln!("scrape-le: {reason}");
                return ExitCode::from(2);
            }
            Err(FetchError::Blocked(reason)) => {
                let report = blocked_report(&url, &reason);
                emit(&report);
                return ExitCode::from(1);
            }
        },
    };
    // The whole check owns the total, render and discovery included.
    evidence.total_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);

    let report = check(&evidence);
    emit(&report);
    match report.verdict {
        Verdict::Clear => ExitCode::SUCCESS,
        _ => ExitCode::from(1),
    }
}

/// Render is best-effort by design: no browser or a failed render
/// returns `None` so the caller falls back to the HTTP-only path, with
/// the reason on stderr instead of a silent over-claim.
fn render_evidence(url: &str, no_render: bool) -> Option<Evidence> {
    if no_render {
        return None;
    }
    let browser = match crate::render::find_browser() {
        Ok(browser) => browser,
        Err(reason) => {
            eprintln!("scrape-le: render unavailable — {reason}");
            return None;
        }
    };
    match crate::render::render(url, browser) {
        Ok(render) => Some(Evidence::from_render(
            url,
            render,
            crate::fetch::fetch_robots_only(url),
        )),
        Err(reason) => {
            eprintln!("scrape-le: render failed — {reason}; falling back to HTTP evidence");
            None
        }
    }
}

fn emit(report: &Report) {
    println!(
        "{}",
        serde_json::to_string_pretty(report).expect("report serializes")
    );
    render_human(report);
}

fn render_human(report: &Report) {
    let count = report.findings.len();
    let noun = if count == 1 { "finding" } else { "findings" };
    let verdict = match report.verdict {
        Verdict::Clear => "clear",
        Verdict::Restricted => "restricted",
        Verdict::Blocked => "blocked",
        Verdict::Inconclusive => "inconclusive",
    };
    eprintln!(
        "\n{verdict} — {count} {noun}  ({} · {}ms · exit {})",
        report.final_url,
        report.timing_ms.total,
        i32::from(report.verdict != Verdict::Clear),
    );
    for finding in &report.findings {
        let severity = match finding.severity {
            Severity::Blocks => "blocks",
            Severity::Warns => "warns ",
        };
        eprintln!("  {severity}  {:<10} {}", finding.kind, finding.detail);
    }
    let checks = [
        ("antibot", report.checks.antibot),
        ("rate-limit", report.checks.rate_limit),
        ("robots", report.checks.robots),
        ("auth", report.checks.auth),
    ];
    let rendered: Vec<String> = checks
        .iter()
        .map(|(name, status)| {
            let mark = match status {
                CheckStatus::Ran => "✓",
                CheckStatus::Partial => "partial (no render)",
                CheckStatus::Skipped => "skipped",
            };
            format!("{name} {mark}")
        })
        .collect();
    eprintln!("  checks  {}", rendered.join("  ·  "));
    if !report.checks_skipped.is_empty() {
        eprintln!("  note    verdict cannot be `clear` until every check runs fully");
    }
}

fn blocked_report(url: &str, reason: &str) -> Report {
    use crate::detect::report::{Checks, Finding, Timing};
    Report {
        schema: 1,
        url: url.to_string(),
        final_url: url.to_string(),
        status: None,
        title: None,
        verdict: Verdict::Blocked,
        findings: vec![Finding {
            kind: "fetch",
            severity: Severity::Blocks,
            detail: reason.to_string(),
            evidence: serde_json::Value::Null,
        }],
        checks: Checks {
            antibot: CheckStatus::Skipped,
            rate_limit: CheckStatus::Skipped,
            robots: CheckStatus::Skipped,
            auth: CheckStatus::Skipped,
        },
        checks_skipped: vec![
            "antibot".to_string(),
            "rate_limit".to_string(),
            "robots".to_string(),
            "auth".to_string(),
        ],
        console_errors: Vec::new(),
        screenshot: None,
        timing_ms: Timing {
            fetch: 0,
            render: None,
            total: 0,
        },
    }
}
