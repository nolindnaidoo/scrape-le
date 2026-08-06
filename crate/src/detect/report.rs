//! The report — the shape both surfaces emit and scripts branch on.
//! `schema: 1`; a breaking change bumps it.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Verdict {
    Clear,
    Restricted,
    Blocked,
    Inconclusive,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Severity {
    Blocks,
    Warns,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct Finding {
    pub(crate) kind: String,
    pub(crate) severity: Severity,
    pub(crate) detail: String,
    pub(crate) evidence: serde_json::Value,
}

/// How completely a check ran. `clear` requires every check `Ran`:
/// a positive finding does not need completeness, a negative one does.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum CheckStatus {
    Ran,
    /// some of the check's signals had no evidence to run against
    /// (e.g. header pass without the rendered DOM)
    Partial,
    Skipped,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct Checks {
    pub(crate) antibot: CheckStatus,
    pub(crate) rate_limit: CheckStatus,
    pub(crate) robots: CheckStatus,
    pub(crate) auth: CheckStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct Timing {
    pub(crate) fetch: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) render: Option<u64>,
    pub(crate) total: u64,
}

/// What robots.txt said, reported whether or not it refused: a reader
/// wants the crawl-delay and the sitemaps even on an allowed path, and
/// `agent` names which group answered.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct RobotsReport {
    pub(crate) exists: bool,
    pub(crate) allows_crawling: bool,
    pub(crate) agent: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) crawl_delay: Option<f64>,
    pub(crate) disallowed_paths: Vec<String>,
    pub(crate) sitemaps: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct Report {
    pub(crate) schema: u32,
    /// present on batch runs: the URL's position in the input
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) index: Option<usize>,
    pub(crate) url: String,
    pub(crate) final_url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) status: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) title: Option<String>,
    pub(crate) verdict: Verdict,
    pub(crate) findings: Vec<Finding>,
    pub(crate) checks: Checks,
    pub(crate) checks_skipped: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) robots: Option<RobotsReport>,
    pub(crate) console_errors: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) screenshot: Option<String>,
    pub(crate) timing_ms: Timing,
}
