//! Batch scheduling. One rule generates the whole design:
//!
//! **Never two concurrent requests to the same host.** A tool whose
//! premise is asking whether it is acceptable to hit a site cannot
//! hammer that site while asking, and a batch of a hundred URLs is very
//! often a hundred paths on one site.
//!
//! So: group by host, run hosts in parallel, run URLs within a host
//! sequentially. Concurrency is a property of the host set, never of
//! the URL count. Ten thousand URLs on one host is a queue of ten
//! thousand, one at a time, and that is correct.

use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::mpsc::{Sender, channel};
use std::thread;
use std::time::Duration;

use crate::detect::report::{Report, Verdict};

/// Chromium contexts are the scarce resource, not sockets.
pub(crate) const DEFAULT_CONCURRENCY: usize = 4;

#[derive(Debug, Clone)]
pub(crate) struct BatchOptions {
    pub(crate) concurrency: usize,
    pub(crate) ignore_crawl_delay: bool,
}

/// One input URL and where it sat in the input.
#[derive(Debug, Clone)]
pub(crate) struct Target {
    pub(crate) index: usize,
    pub(crate) url: String,
}

/// Parses batch input by **content, not extension**: a JSON array of
/// strings, a JSON array of objects carrying a `url` key, a CSV with a
/// `url` column, or a bare newline-separated list.
pub(crate) fn parse_input(raw: &str) -> Result<Vec<String>, String> {
    // A leading byte-order mark is three invisible bytes that Notepad,
    // Excel and a PowerShell redirect all add, and `str::trim_start`
    // does not remove it. Left in, a JSON array stops starting with `[`
    // and the whole file is read as a single line — one malformed entry
    // where there were fifty URLs, and nothing on screen to explain it.
    let raw = raw.strip_prefix('\u{feff}').unwrap_or(raw);
    let trimmed = raw.trim_start();
    if trimmed.starts_with('[') {
        return parse_json_array(trimmed);
    }
    Ok(parse_lines(raw))
}

fn parse_json_array(raw: &str) -> Result<Vec<String>, String> {
    let parsed: serde_json::Value =
        serde_json::from_str(raw).map_err(|e| format!("input is not valid JSON: {e}"))?;
    let items = parsed
        .as_array()
        .ok_or_else(|| "JSON input must be an array".to_string())?;
    let mut urls = Vec::with_capacity(items.len());
    for (position, item) in items.iter().enumerate() {
        let url = match item {
            serde_json::Value::String(url) => url.clone(),
            serde_json::Value::Object(object) => object
                .get("url")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| format!("entry {position} has no `url` key"))?
                .to_string(),
            _ => {
                return Err(format!(
                    "entry {position} is neither a string nor an object"
                ));
            }
        };
        urls.push(url);
    }
    Ok(urls)
}

/// CSV or a bare list. A `url` column is honoured when the first line
/// is a header naming one; otherwise every line is a URL and any
/// trailing columns are ignored.
fn parse_lines(raw: &str) -> Vec<String> {
    let lines: Vec<&str> = raw
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .collect();
    let Some(first) = lines.first() else {
        return Vec::new();
    };

    let header: Vec<String> = first.split(',').map(|c| c.trim().to_lowercase()).collect();
    let url_column = header.iter().position(|column| column == "url");
    let body = match url_column {
        Some(_) => &lines[1..],
        None => &lines[..],
    };
    let column = url_column.unwrap_or(0);

    body.iter()
        .filter_map(|line| {
            let field = line.split(',').nth(column)?.trim();
            (!field.is_empty()).then(|| field.trim_matches('"').to_string())
        })
        .collect()
}

/// Groups targets by host, preserving input order within each host.
/// A URL that will not parse keeps its own bucket keyed by the raw
/// string, so it still runs, still reports, and cannot silently vanish
/// from the batch.
pub(crate) fn group_by_host(targets: &[Target]) -> Vec<Vec<Target>> {
    let mut order: Vec<String> = Vec::new();
    let mut hosts: HashMap<String, Vec<Target>> = HashMap::new();
    for target in targets {
        let host = url::Url::parse(&target.url)
            .ok()
            .and_then(|parsed| parsed.host_str().map(str::to_lowercase))
            .unwrap_or_else(|| target.url.clone());
        if !hosts.contains_key(&host) {
            order.push(host.clone());
        }
        hosts.entry(host).or_default().push(target.clone());
    }
    order
        .into_iter()
        .filter_map(|host| hosts.remove(&host))
        .collect()
}

/// Runs the batch, streaming each report to `emit` as it completes.
/// Returns the worst verdict seen, which is the process exit code.
///
/// `check_one` is the per-URL work, injected so tests drive the
/// scheduler without a network.
pub(crate) fn run<F>(
    targets: &[Target],
    options: &BatchOptions,
    check_one: F,
    emit: &(dyn Fn(&Report) + Sync),
) -> Summary
where
    F: Fn(&Target) -> Report + Sync,
{
    let groups = group_by_host(targets);
    let queue = Mutex::new(groups.into_iter().collect::<Vec<_>>());
    let (tx, rx) = channel::<Report>();
    let workers = options.concurrency.max(1).min(worker_ceiling(targets));

    // Exact-duplicate URLs are checked once: same URL, same run, same
    // answer, and a second render spends seconds to learn nothing. Each
    // input index still gets its own record.
    let seen: Mutex<HashMap<String, Report>> = Mutex::new(HashMap::new());

    thread::scope(|scope| {
        for _ in 0..workers {
            let tx: Sender<Report> = tx.clone();
            let queue = &queue;
            let seen = &seen;
            let check_one = &check_one;
            let options = options.clone();
            scope.spawn(move || {
                loop {
                    let Some(group) = queue.lock().ok().and_then(|mut q| q.pop()) else {
                        return;
                    };
                    let mut delay: Option<Duration> = None;
                    for target in group {
                        // Crawl-delay is honoured between same-host
                        // requests: reporting a site's declared delay
                        // while ignoring it is hypocrisy the rest of
                        // this design does not permit.
                        if let Some(wait) = delay.take()
                            && !options.ignore_crawl_delay
                        {
                            thread::sleep(wait);
                        }
                        let cached = seen
                            .lock()
                            .ok()
                            .and_then(|map| map.get(&target.url).map(clone_for_index));
                        let report = if let Some(mut report) = cached {
                            report.index = Some(target.index);
                            report
                        } else {
                            let report = check_one(&target);
                            if let Ok(mut map) = seen.lock() {
                                map.insert(target.url.clone(), clone_for_index(&report));
                            }
                            report
                        };
                        delay = report
                            .robots
                            .as_ref()
                            .and_then(|robots| robots.crawl_delay)
                            .filter(|seconds| *seconds > 0.0)
                            .map(Duration::from_secs_f64);
                        if tx.send(report).is_err() {
                            return;
                        }
                    }
                }
            });
        }
        drop(tx);

        let mut summary = Summary::default();
        for report in rx {
            summary.record(&report);
            emit(&report);
        }
        summary
    })
}

/// More workers than host groups would idle; more than the URL count is
/// meaningless.
fn worker_ceiling(targets: &[Target]) -> usize {
    group_by_host(targets).len().max(1)
}

/// A report is cloned for reuse by serializing through its own JSON —
/// the only shape that must stay stable anyway, and cheaper to keep
/// correct than a hand-written Clone across the whole tree.
fn clone_for_index(report: &Report) -> Report {
    let value = serde_json::to_value(report).expect("report serializes");
    serde_json::from_value(value).expect("report round-trips")
}

#[derive(Debug, Default)]
pub(crate) struct Summary {
    pub(crate) clear: usize,
    pub(crate) restricted: usize,
    pub(crate) blocked: usize,
    pub(crate) inconclusive: usize,
}

impl Summary {
    fn record(&mut self, report: &Report) {
        match report.verdict {
            Verdict::Clear => self.clear += 1,
            Verdict::Restricted => self.restricted += 1,
            Verdict::Blocked => self.blocked += 1,
            Verdict::Inconclusive => self.inconclusive += 1,
        }
    }

    pub(crate) fn total(&self) -> usize {
        self.clear + self.restricted + self.blocked + self.inconclusive
    }

    /// The exit code is the worst verdict in the batch.
    pub(crate) fn worst_is_clear(&self) -> bool {
        self.restricted == 0 && self.blocked == 0 && self.inconclusive == 0 && self.clear > 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::detect::report::{CheckStatus, Checks, Timing};

    fn target(index: usize, url: &str) -> Target {
        Target {
            index,
            url: url.to_string(),
        }
    }

    fn report_for(target: &Target, verdict: Verdict) -> Report {
        Report {
            schema: 1,
            index: Some(target.index),
            url: target.url.clone(),
            final_url: target.url.clone(),
            status: Some(200),
            title: None,
            verdict,
            findings: Vec::new(),
            checks: Checks {
                antibot: CheckStatus::Ran,
                rate_limit: CheckStatus::Ran,
                robots: CheckStatus::Ran,
                auth: CheckStatus::Ran,
            },
            checks_skipped: Vec::new(),
            robots: None,
            console_errors: Vec::new(),
            screenshot: None,
            timing_ms: Timing {
                fetch: 1,
                render: None,
                total: 1,
            },
        }
    }

    fn options() -> BatchOptions {
        BatchOptions {
            concurrency: DEFAULT_CONCURRENCY,
            ignore_crawl_delay: true,
        }
    }

    #[test]
    fn json_array_of_strings_parses() {
        let urls = parse_input(r#"["https://a.com", "https://b.com"]"#).expect("parses");
        assert_eq!(urls, ["https://a.com", "https://b.com"]);
    }

    /// **Regression.** `str::trim_start` does not remove a byte-order
    /// mark, so a JSON batch saved by Notepad stopped starting with `[`
    /// and the whole array was read as one line — fifty URLs collapsing
    /// into one malformed entry, with nothing on screen to say why.
    #[test]
    fn a_byte_order_mark_does_not_hide_a_json_array() {
        let urls = parse_input("\u{feff}[\"https://a.com\", \"https://b.com\"]").expect("parses");
        assert_eq!(urls, ["https://a.com", "https://b.com"]);
    }

    #[test]
    fn a_byte_order_mark_does_not_hide_a_csv_header() {
        let urls = parse_input("\u{feff}url,note\nhttps://a.com,first").expect("parses");
        assert_eq!(urls, ["https://a.com"]);
    }

    #[test]
    fn json_array_of_objects_parses() {
        let urls = parse_input(r#"[{"url":"https://a.com","note":"x"}]"#).expect("parses");
        assert_eq!(urls, ["https://a.com"]);
    }

    #[test]
    fn json_entry_without_url_names_the_position() {
        let error = parse_input(r#"[{"link":"https://a.com"}]"#).expect_err("must fail");
        assert!(error.contains("entry 0"), "{error}");
    }

    #[test]
    fn csv_with_url_column_parses() {
        let urls =
            parse_input("url,note\nhttps://a.com,first\nhttps://b.com,second").expect("parses");
        assert_eq!(urls, ["https://a.com", "https://b.com"]);
    }

    #[test]
    fn csv_url_column_can_be_second() {
        let urls = parse_input("note,url\nfirst,https://a.com").expect("parses");
        assert_eq!(urls, ["https://a.com"]);
    }

    #[test]
    fn bare_list_parses_and_skips_comments() {
        let urls = parse_input("https://a.com\n# a comment\n\nhttps://b.com\n").expect("parses");
        assert_eq!(urls, ["https://a.com", "https://b.com"]);
    }

    #[test]
    fn grouping_keeps_one_bucket_per_host_in_input_order() {
        let targets = vec![
            target(0, "https://a.com/1"),
            target(1, "https://b.com/1"),
            target(2, "https://a.com/2"),
        ];
        let groups = group_by_host(&targets);
        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0].len(), 2);
        assert_eq!(groups[0][0].index, 0);
        assert_eq!(groups[0][1].index, 2);
        assert_eq!(groups[1][0].index, 1);
    }

    #[test]
    fn unparseable_urls_still_get_a_bucket() {
        let targets = vec![target(0, "not a url"), target(1, "https://a.com")];
        assert_eq!(group_by_host(&targets).len(), 2);
    }

    #[test]
    fn every_input_index_gets_a_report() {
        let targets = vec![
            target(0, "https://a.com/1"),
            target(1, "https://b.com/1"),
            target(2, "https://a.com/2"),
            target(3, "https://c.com/1"),
        ];
        let seen = Mutex::new(Vec::new());
        let summary = run(
            &targets,
            &options(),
            |t| report_for(t, Verdict::Clear),
            &|report| seen.lock().expect("lock").push(report.index),
        );
        let mut indices: Vec<usize> = seen
            .into_inner()
            .expect("into_inner")
            .into_iter()
            .flatten()
            .collect();
        indices.sort_unstable();
        assert_eq!(indices, [0, 1, 2, 3]);
        assert_eq!(summary.total(), 4);
        assert!(summary.worst_is_clear());
    }

    #[test]
    fn same_host_urls_never_run_concurrently() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let targets: Vec<Target> = (0..6)
            .map(|i| target(i, &format!("https://one.com/{i}")))
            .collect();
        let in_flight = AtomicUsize::new(0);
        let peak = AtomicUsize::new(0);
        run(
            &targets,
            &options(),
            |t| {
                let now = in_flight.fetch_add(1, Ordering::SeqCst) + 1;
                peak.fetch_max(now, Ordering::SeqCst);
                thread::sleep(Duration::from_millis(5));
                in_flight.fetch_sub(1, Ordering::SeqCst);
                report_for(t, Verdict::Clear)
            },
            &|_| {},
        );
        assert_eq!(peak.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn duplicate_urls_are_checked_once() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let targets = vec![
            target(0, "https://a.com/x"),
            target(1, "https://a.com/x"),
            target(2, "https://a.com/x"),
        ];
        let calls = AtomicUsize::new(0);
        let seen = Mutex::new(Vec::new());
        run(
            &targets,
            &options(),
            |t| {
                calls.fetch_add(1, Ordering::SeqCst);
                report_for(t, Verdict::Clear)
            },
            &|report| seen.lock().expect("lock").push(report.index),
        );
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(seen.into_inner().expect("into_inner").len(), 3);
    }

    #[test]
    fn worst_verdict_decides_the_batch() {
        let targets = vec![target(0, "https://a.com"), target(1, "https://b.com")];
        let summary = run(
            &targets,
            &options(),
            |t| {
                let verdict = if t.index == 0 {
                    Verdict::Clear
                } else {
                    Verdict::Restricted
                };
                report_for(t, verdict)
            },
            &|_| {},
        );
        assert!(!summary.worst_is_clear());
        assert_eq!(summary.clear, 1);
        assert_eq!(summary.restricted, 1);
    }

    #[test]
    fn one_failing_url_never_stops_the_batch() {
        let targets: Vec<Target> = (0..5)
            .map(|i| target(i, &format!("https://h{i}.com/x")))
            .collect();
        let summary = run(
            &targets,
            &options(),
            |t| {
                let verdict = if t.index == 2 {
                    Verdict::Blocked
                } else {
                    Verdict::Clear
                };
                report_for(t, verdict)
            },
            &|_| {},
        );
        assert_eq!(summary.total(), 5);
        assert_eq!(summary.blocked, 1);
    }
}
