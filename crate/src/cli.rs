//! The terminal surface. stdout is always protocol (one JSON report),
//! stderr is always for the human — a projection of the same report,
//! never parallel prose. Exit codes are the API: 0 `clear`, 1 not a
//! yes, 2 the question was malformed.

use std::process::ExitCode;

use crate::detect::check::{Evidence, check};
use crate::detect::report::{CheckStatus, Report, Severity, Verdict};
use crate::detect::url::{normalize_url, validate_url};
use crate::fetch::{FetchError, fetch_evidence};

const USAGE: &str = "usage: scrape-le <url>
       scrape-le --version | --help

Checks whether a page is scrapeable and reports what would block a
scraper: robots.txt, anti-bot vendors, rate limits, auth walls.
JSON report on stdout, human summary on stderr.

Exit codes: 0 clear · 1 restricted/blocked/inconclusive · 2 malformed question.

Rendering is not wired yet: checks that need the browser run partially
and the verdict can never be `clear` — it says so in the report.";

pub(crate) fn run() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.as_slice() {
        [] => {
            eprintln!("{USAGE}");
            ExitCode::from(2)
        }
        [flag] if flag == "--help" || flag == "-h" => {
            println!("{USAGE}");
            ExitCode::SUCCESS
        }
        [flag] if flag == "--version" || flag == "-V" => {
            println!("scrape-le {}", env!("CARGO_PKG_VERSION"));
            ExitCode::SUCCESS
        }
        [url] => check_one(url),
        _ => {
            eprintln!("scrape-le: one URL per run for now — batch --input is not implemented yet");
            ExitCode::from(2)
        }
    }
}

fn check_one(raw: &str) -> ExitCode {
    let url = normalize_url(raw);
    if !validate_url(&url) {
        eprintln!("scrape-le: not an http(s) URL: {raw}");
        return ExitCode::from(2);
    }

    let evidence: Evidence = match fetch_evidence(&url) {
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
    };

    let report = check(&evidence);
    emit(&report);
    match report.verdict {
        Verdict::Clear => ExitCode::SUCCESS,
        _ => ExitCode::from(1),
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
