//! The terminal surface. stdout is protocol (JSON reports, one per URL)
//! whenever something is reading it, and silent when it is a terminal.
//! stderr is always for the human — a projection of the same report,
//! never parallel prose. Exit codes are the API: 0 `clear`, 1 not a yes,
//! 2 the question was malformed.

use std::io::{IsTerminal, Read, Write};
use std::path::PathBuf;
use std::process::ExitCode;
use std::sync::Mutex;

use crate::batch::{BatchOptions, DEFAULT_CONCURRENCY, Summary, Target};
use crate::check_url::{CheckOutcome, check_url};
use crate::detect::report::{CheckStatus, Report, Severity, Verdict};
use crate::detect::url::{target_in_text, target_url};
use crate::fetch::RobotsCache;

const USAGE: &str = "usage: scrape-le [options] <url>
       scrape-le [options] --input <file|->
       scrape-le doctor
       scrape-le mcp
       scrape-le --version | --help

Checks whether a page is scrapeable and reports what would block a
scraper: robots.txt, anti-bot vendors, rate limits, auth walls.
JSON reports on stdout when it is piped or redirected, human summary on
stderr. At a terminal stdout stays silent.

Options:
  --no-render            skip the browser; the verdict can then never be
                         `clear`, and the report says why
  --agent <token>        evaluate robots.txt as this crawler (RFC 9309
                         group selection); default is User-agent: *
  --signatures <file>    add or replace vendor signatures from a TOML file
  --input <file|->       batch: a JSON array, a CSV with a url column, or
                         one URL per line, detected by content
  --concurrency <n>      hosts checked at once (default 4). URLs on the
                         same host are always sequential
  --ignore-crawl-delay   do not honour a site's declared Crawl-delay;
                         recorded in the report when used

Rendering is the default and drives a browser you already have (Chrome,
Chromium, Brave, Edge — or set CHROME). It never downloads one. Every
rendered check writes a full-page PNG into the working directory, one
per URL per day, and the report names the file.

Exit codes: 0 clear · 1 restricted/blocked/inconclusive · 2 malformed question.
For a batch, the exit code is the worst verdict in it.";

/// Everything the run needs, after parsing. Kept flat and owned so the
/// batch workers can share it without lifetime gymnastics.
pub(crate) struct Options {
    pub(crate) no_render: bool,
    pub(crate) agent: Option<String>,
    pub(crate) concurrency: usize,
    pub(crate) ignore_crawl_delay: bool,
}

pub(crate) fn run() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if let Some(first) = args.first() {
        match first.as_str() {
            "doctor" => return doctor(),
            "mcp" => return crate::mcp::serve(),
            _ => {}
        }
    }

    let parsed = match parse_args(&args) {
        Ok(parsed) => parsed,
        Err(Exit::Message(message)) => {
            println!("{message}");
            return ExitCode::SUCCESS;
        }
        Err(Exit::Error(message)) => {
            eprintln!("scrape-le: {message}");
            return ExitCode::from(2);
        }
    };

    match parsed.input {
        Some(source) => run_batch(&source, &parsed.options),
        None => match parsed.urls.as_slice() {
            [] => {
                eprintln!("{USAGE}");
                ExitCode::from(2)
            }
            [url] => run_single(url, &parsed.options),
            _ => {
                let targets: Vec<Target> = parsed
                    .urls
                    .iter()
                    .enumerate()
                    .map(|(index, url)| Target {
                        index,
                        url: url.clone(),
                    })
                    .collect();
                run_targets(&targets, &parsed.options)
            }
        },
    }
}

enum Exit {
    /// printed to stdout, exit 0 — `--help`, `--version`
    Message(String),
    /// printed to stderr, exit 2 — the question was malformed
    Error(String),
}

struct Parsed {
    options: Options,
    urls: Vec<String>,
    input: Option<String>,
}

fn parse_args(args: &[String]) -> Result<Parsed, Exit> {
    let mut options = Options {
        no_render: false,
        agent: None,
        concurrency: DEFAULT_CONCURRENCY,
        ignore_crawl_delay: false,
    };
    let mut urls: Vec<String> = Vec::new();
    let mut input: Option<String> = None;
    let mut signatures: Option<PathBuf> = None;

    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--help" | "-h" => return Err(Exit::Message(USAGE.to_string())),
            "--version" | "-V" => {
                return Err(Exit::Message(format!(
                    "scrape-le {}",
                    env!("CARGO_PKG_VERSION")
                )));
            }
            "--no-render" => options.no_render = true,
            "--ignore-crawl-delay" => options.ignore_crawl_delay = true,
            "--agent" => options.agent = Some(value(&mut iter, "--agent")?),
            "--signatures" => signatures = Some(PathBuf::from(value(&mut iter, "--signatures")?)),
            "--input" => input = Some(value(&mut iter, "--input")?),
            "--concurrency" => {
                let raw = value(&mut iter, "--concurrency")?;
                let parsed: usize = raw
                    .parse()
                    .map_err(|_| Exit::Error(format!("--concurrency needs a number, got {raw}")))?;
                if parsed == 0 {
                    return Err(Exit::Error("--concurrency must be at least 1".to_string()));
                }
                options.concurrency = parsed;
            }
            flag if flag.starts_with('-') && flag != "-" => {
                return Err(Exit::Error(format!("unknown flag {flag}\n\n{USAGE}")));
            }
            url => urls.push(url.to_string()),
        }
    }

    if let Some(path) = signatures {
        let count = crate::detect::signatures::load_extra(&path).map_err(Exit::Error)?;
        eprintln!(
            "scrape-le: loaded {count} signature(s) from {}",
            path.display()
        );
    }

    Ok(Parsed {
        options,
        urls,
        input,
    })
}

fn value<'a>(iter: &mut impl Iterator<Item = &'a String>, flag: &str) -> Result<String, Exit> {
    iter.next()
        .cloned()
        .ok_or_else(|| Exit::Error(format!("{flag} needs a value")))
}

fn run_single(raw: &str, options: &Options) -> ExitCode {
    let Some(url) = target_url(raw) else {
        eprintln!("scrape-le: not an http(s) URL: {raw}");
        return ExitCode::from(2);
    };
    match check_url(&url, None, options, &RobotsCache::new()) {
        CheckOutcome::Malformed(reason) => {
            eprintln!("scrape-le: {reason}");
            ExitCode::from(2)
        }
        CheckOutcome::Report(report) => {
            emit(&report, std::io::stdout().is_terminal());
            show(&report);
            match report.verdict {
                Verdict::Clear => ExitCode::SUCCESS,
                _ => ExitCode::from(1),
            }
        }
    }
}

fn run_batch(source: &str, options: &Options) -> ExitCode {
    let raw = match read_input(source) {
        Ok(raw) => raw,
        Err(reason) => {
            eprintln!("scrape-le: {reason}");
            return ExitCode::from(2);
        }
    };
    let urls = match crate::batch::parse_input(&raw) {
        Ok(urls) => urls,
        Err(reason) => {
            eprintln!("scrape-le: {reason}");
            return ExitCode::from(2);
        }
    };
    if urls.is_empty() {
        eprintln!("scrape-le: no URLs in {source}");
        return ExitCode::from(2);
    }

    // A malformed entry names its position and does not poison the rest
    // of the batch, which still runs and still reports.
    let mut targets = Vec::with_capacity(urls.len());
    let mut malformed = 0;
    for (index, raw_url) in urls.iter().enumerate() {
        // A batch line may carry a URL amid other text (a log line, a
        // note column); `target_in_text` finds it and falls back to
        // plain normalization for a bare domain.
        let Some(url) = target_in_text(raw_url) else {
            eprintln!("scrape-le: entry {index} is not an http(s) URL: {raw_url}");
            malformed += 1;
            continue;
        };
        targets.push(Target { index, url });
    }
    if targets.is_empty() {
        return ExitCode::from(2);
    }

    let code = run_targets(&targets, options);
    if malformed > 0 {
        // **2 is the worst outcome, not one between 0 and 1.** This
        // escalated only when every URL that ran came back `clear`, so a
        // malformed entry beside a `restricted` one exited 1 — the
        // entry was named on stderr and the code said the question was
        // fine. A caller branching on the code learned nothing about the
        // input it had just been told was broken.
        return ExitCode::from(2);
    }
    code
}

fn run_targets(targets: &[Target], options: &Options) -> ExitCode {
    let batch_options = BatchOptions {
        concurrency: options.concurrency,
        ignore_crawl_delay: options.ignore_crawl_delay,
    };
    let started = std::time::Instant::now();
    let terminal = std::io::stdout().is_terminal();
    let hosts = crate::batch::group_by_host(targets).len();
    let malformed = Mutex::new(0usize);
    // One robots.txt per origin for the whole batch, shared across the
    // workers: the grouping already puts every URL on a host in one
    // queue, so this is the fetch and the parse that grouping was
    // supposed to save.
    let robots = RobotsCache::new();

    let summary: Summary = crate::batch::run(
        targets,
        &batch_options,
        |target| match check_url(&target.url, Some(target.index), options, &robots) {
            CheckOutcome::Report(report) => *report,
            CheckOutcome::Malformed(reason) => {
                eprintln!("scrape-le: entry {}: {reason}", target.index);
                if let Ok(mut count) = malformed.lock() {
                    *count += 1;
                }
                blocked_report(
                    &target.url,
                    &reason,
                    Some(target.index),
                    options.ignore_crawl_delay,
                )
            }
        },
        // Each report is listed on stderr as it completes, not only
        // counted: stdout is silent at a terminal, and a batch whose
        // human half held nothing but a tally would hide every verdict.
        &|report| {
            emit(report, terminal);
            show(report);
        },
    );

    eprintln!(
        "\n{} clear · {} restricted · {} blocked · {} inconclusive",
        summary.clear, summary.restricted, summary.blocked, summary.inconclusive
    );
    eprintln!(
        "{} URLs across {hosts} host(s) in {:.1}s",
        summary.total(),
        started.elapsed().as_secs_f64()
    );
    // A batch is where the wait actually costs something, and the batch
    // summary is the only human output it produces — so the fact the
    // reports carry is said here rather than only in the JSON.
    if options.ignore_crawl_delay {
        eprintln!("declared Crawl-delay not waited for (--ignore-crawl-delay)");
    }
    if options.no_render {
        eprintln!("verdicts cannot be `clear` until every check runs fully (--no-render)");
    }

    if malformed.into_inner().unwrap_or(0) > 0 {
        return ExitCode::from(2);
    }
    if summary.worst_is_clear() {
        return ExitCode::SUCCESS;
    }
    ExitCode::from(1)
}

fn read_input(source: &str) -> Result<String, String> {
    if source == "-" {
        let mut raw = String::new();
        return std::io::stdin()
            .read_to_string(&mut raw)
            .map(|_| raw)
            .map_err(|e| format!("could not read stdin: {e}"));
    }
    // A named pipe is not a batch file, and `read_to_string` on one with
    // no writer never returns — a run that hangs is worse than one that
    // refuses, because nobody can tell it from a slow batch. The same
    // guard sits in `detect::signatures::load_extra`, which reads the
    // other file this tool is handed by name.
    let metadata =
        std::fs::metadata(source).map_err(|e| format!("could not read {source}: {e}"))?;
    if !metadata.is_file() {
        return Err(format!("could not read {source}: not a regular file"));
    }
    std::fs::read_to_string(source).map_err(|e| format!("could not read {source}: {e}"))
}

/// Is a browser available, which one, and what will run — the question
/// answered up front rather than at the end of a failed check.
fn doctor() -> ExitCode {
    match crate::render::find_browser() {
        Ok(path) => {
            println!("browser: {}", path.display());
            println!("render:  available — every check can run, `clear` is reachable");
            println!("http:    available — robots.txt, status, headers, redirects");
            ExitCode::SUCCESS
        }
        Err(reason) => {
            println!("browser: not found");
            println!("render:  unavailable — {reason}");
            println!(
                "http:    available — robots.txt, status, headers and redirects still answer,\n\
                 \x20        but anti-bot and authentication run partially and the verdict\n\
                 \x20        can never be `clear`"
            );
            ExitCode::from(1)
        }
    }
}

fn emit(report: &Report, terminal: bool) {
    write_report(&mut std::io::stdout().lock(), report, terminal).expect("stdout is writable");
}

/// A terminal gets nothing here. The stderr summary already says
/// everything a person reads, and the JSON beside it on the same screen
/// is the same answer a second time in a form nobody reads by eye.
/// Anything that can parse — a pipe, a file, a subprocess — still gets
/// every report, so no script sees a difference.
fn write_report(out: &mut impl Write, report: &Report, terminal: bool) -> std::io::Result<()> {
    if terminal {
        return Ok(());
    }
    let line = serde_json::to_string(report).expect("report serializes");
    writeln!(out, "{line}")
}

/// One report as a single write, so two workers finishing together
/// cannot interleave their lines.
fn show(report: &Report) {
    let mut text = Vec::new();
    write_human(&mut text, report).expect("a Vec accepts every write");
    let _ = std::io::stderr().lock().write_all(&text);
}

fn write_human(out: &mut impl Write, report: &Report) -> std::io::Result<()> {
    let count = report.findings.len();
    let noun = if count == 1 { "finding" } else { "findings" };
    let verdict = verdict_word(report.verdict);
    // A batch names the input position, because two entries can be the
    // same URL and the verdicts arrive in completion order.
    let position = report
        .index
        .map(|index| format!("[{index}] "))
        .unwrap_or_default();
    writeln!(
        out,
        "\n{position}{verdict} — {count} {noun}  ({} · {}ms · exit {})",
        report.final_url,
        report.timing_ms.total,
        i32::from(report.verdict != Verdict::Clear),
    )?;
    for finding in &report.findings {
        let severity = match finding.severity {
            Severity::Blocks => "blocks",
            Severity::Warns => "warns ",
        };
        writeln!(out, "  {severity}  {:<10} {}", finding.kind, finding.detail)?;
    }
    if let Some(robots) = &report.robots
        && let Some(delay) = robots.crawl_delay
    {
        writeln!(
            out,
            "  robots  Crawl-delay: {delay}s (User-agent: {})",
            robots.agent
        )?;
    }
    // The summary is a projection of the report, so what the report
    // records about how it was obtained is said here too. A batch says
    // it once in its closing lines instead of under every URL.
    if report.crawl_delay_ignored && report.index.is_none() {
        writeln!(
            out,
            "  robots  declared Crawl-delay not waited for (--ignore-crawl-delay)"
        )?;
    }
    // The report names the file; a person at a terminal has no report,
    // and a render writes into the working directory.
    if let Some(screenshot) = &report.screenshot {
        writeln!(out, "  shot    {screenshot}")?;
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
    writeln!(out, "  checks  {}", rendered.join("  ·  "))?;
    if !report.checks_skipped.is_empty() && report.index.is_none() {
        writeln!(
            out,
            "  note    verdict cannot be `clear` until every check runs fully"
        )?;
    }
    Ok(())
}

fn verdict_word(verdict: Verdict) -> &'static str {
    match verdict {
        Verdict::Clear => "clear",
        Verdict::Restricted => "restricted",
        Verdict::Blocked => "blocked",
        Verdict::Inconclusive => "inconclusive",
    }
}

pub(crate) fn blocked_report(
    url: &str,
    reason: &str,
    index: Option<usize>,
    crawl_delay_ignored: bool,
) -> Report {
    use crate::detect::report::{Checks, Finding, Timing};
    Report {
        schema: 1,
        index,
        url: url.to_string(),
        final_url: url.to_string(),
        status: None,
        title: None,
        verdict: Verdict::Blocked,
        findings: vec![Finding {
            kind: "fetch".to_string(),
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
        robots: None,
        console_errors: Vec::new(),
        screenshot: None,
        crawl_delay_ignored,
        timing_ms: Timing {
            fetch: 0,
            render: None,
            total: 0,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(index: Option<usize>) -> Report {
        blocked_report("https://example.com/a", "refused", index, false)
    }

    #[test]
    fn a_pipe_gets_one_report_per_line() {
        let mut out = Vec::new();
        write_report(&mut out, &sample(None), false).expect("a write");
        write_report(&mut out, &sample(Some(1)), false).expect("a write");
        let text = String::from_utf8(out).expect("utf-8");
        assert_eq!(text.lines().count(), 2);
        assert!(text.starts_with('{'), "{text}");
    }

    /// The summary on stderr already covers a person at a terminal.
    #[test]
    fn a_terminal_gets_no_json() {
        let mut out = Vec::new();
        write_report(&mut out, &sample(None), true).expect("a write");
        assert!(out.is_empty());
    }

    fn human(report: &Report) -> String {
        let mut out = Vec::new();
        write_human(&mut out, report).expect("a write");
        String::from_utf8(out).expect("utf-8")
    }

    /// With stdout silent at a terminal, a batch's stderr must say what
    /// each URL came to, not only how many of each verdict there were.
    #[test]
    fn a_batch_entry_is_listed_with_its_position_and_verdict() {
        let text = human(&sample(Some(3)));
        assert!(text.contains("[3] blocked — 1 finding"), "{text}");
        assert!(text.contains("https://example.com/a"), "{text}");
        assert!(text.contains("refused"), "{text}");
    }

    #[test]
    fn a_single_check_has_no_position_prefix() {
        assert!(!human(&sample(None)).contains('['));
    }

    #[test]
    fn a_screenshot_is_named_on_stderr() {
        let mut report = sample(None);
        report.screenshot = Some("example.com-2026-10-15.png".to_string());
        assert!(human(&report).contains("  shot    example.com-2026-10-15.png"));
    }

    /// A batch says these once in its closing lines.
    #[test]
    fn a_batch_entry_does_not_repeat_what_the_summary_says_once() {
        let mut report = sample(Some(0));
        report.crawl_delay_ignored = true;
        let text = human(&report);
        assert!(!text.contains("Crawl-delay"), "{text}");
        assert!(!text.contains("note "), "{text}");
    }
}
