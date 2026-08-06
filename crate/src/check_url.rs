//! One URL, end to end: gather evidence, decide, return the report.
//!
//! **Both surfaces call this and nothing else.** The CLI and the MCP
//! server share it so neither can grow its own copy of a rule, or
//! answer the same URL differently.

use crate::cli::Options;
use crate::detect::check::{CheckOptions, Evidence, check};
use crate::detect::report::Report;
use crate::fetch::{FetchError, fetch_evidence};

pub(crate) enum CheckOutcome {
    /// boxed: a Report is an order of magnitude larger than a refusal,
    /// and every caller matches rather than copies
    Report(Box<Report>),
    /// the question itself was malformed — unparseable URL, DNS
    /// failure, timeout
    Malformed(String),
}

pub(crate) fn check_url(url: &str, index: Option<usize>, options: &Options) -> CheckOutcome {
    let started = std::time::Instant::now();

    // The rendered path loads the page once, in the browser, and takes
    // its status and headers from the document's CDP response — asking
    // whether a site may be scraped must not cost that site two hits.
    // Only robots.txt is fetched alongside it.
    let mut evidence: Evidence = match render_evidence(url, options) {
        Some(evidence) => evidence,
        None => match fetch_evidence(url) {
            Ok(evidence) => evidence,
            Err(FetchError::Malformed(reason)) => return CheckOutcome::Malformed(reason),
            Err(FetchError::Blocked(reason)) => {
                return CheckOutcome::Report(Box::new(crate::cli::blocked_report(
                    url, &reason, index,
                )));
            }
        },
    };
    // The whole check owns the total, render and discovery included.
    evidence.total_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);

    let report = check(
        &evidence,
        &CheckOptions {
            agent: options.agent.clone(),
            index,
        },
    );
    CheckOutcome::Report(Box::new(report))
}

/// Render is best-effort by design: no browser or a failed render
/// returns `None` so the caller falls back to the HTTP-only path, with
/// the reason on stderr instead of a silent over-claim.
fn render_evidence(url: &str, options: &Options) -> Option<Evidence> {
    if options.no_render {
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
