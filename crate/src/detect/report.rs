//! The report — the shape both surfaces emit and scripts branch on.
//! `schema: 1`; a breaking change bumps it.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Verdict {
    Clear,
    Restricted,
    Blocked,
    Inconclusive,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Severity {
    Blocks,
    Warns,
}

#[derive(Debug, Serialize)]
pub(crate) struct Finding {
    pub(crate) kind: &'static str,
    pub(crate) severity: Severity,
    pub(crate) detail: String,
    pub(crate) evidence: serde_json::Value,
}

/// How completely a check ran. `clear` requires every check `Ran`:
/// a positive finding does not need completeness, a negative one does.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum CheckStatus {
    Ran,
    /// some of the check's signals had no evidence to run against
    /// (e.g. header pass without the rendered DOM)
    Partial,
    Skipped,
}

#[derive(Debug, Serialize)]
pub(crate) struct Checks {
    pub(crate) antibot: CheckStatus,
    pub(crate) rate_limit: CheckStatus,
    pub(crate) robots: CheckStatus,
    pub(crate) auth: CheckStatus,
}

#[derive(Debug, Serialize)]
pub(crate) struct Timing {
    pub(crate) fetch: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) render: Option<u64>,
    pub(crate) total: u64,
}

#[derive(Debug, Serialize)]
pub(crate) struct Report {
    pub(crate) schema: u32,
    pub(crate) url: String,
    pub(crate) final_url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) status: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) title: Option<String>,
    pub(crate) verdict: Verdict,
    pub(crate) findings: Vec<Finding>,
    pub(crate) checks: Checks,
    pub(crate) checks_skipped: Vec<String>,
    pub(crate) console_errors: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) screenshot: Option<String>,
    pub(crate) timing_ms: Timing,
}
