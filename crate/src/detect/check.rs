//! `check()` — evidence in, report out. Both surfaces call this and
//! nothing else, so neither can grow its own copy of a rule. Pure:
//! `fetch.rs`/`render.rs` gather the evidence, this decides.

use std::collections::HashMap;

use serde_json::json;

use super::antibot::match_headers;
use super::auth::detect_authentication;
use super::ratelimit::detect_rate_limit;
use super::report::{CheckStatus, Checks, Finding, Report, Severity, Timing, Verdict};
use super::robots::parse_robots_txt;
use super::signatures::signatures;

/// What a fetch (and later a render) produced. `robots_body` is `None`
/// when robots.txt did not exist or was unreachable — distinct from an
/// empty file.
pub(crate) struct Evidence {
    pub(crate) url: String,
    pub(crate) final_url: String,
    pub(crate) status: Option<u16>,
    /// lowercased header names, as delivered
    pub(crate) headers: HashMap<String, String>,
    pub(crate) body_html: String,
    pub(crate) robots_body: Option<String>,
    pub(crate) fetch_ms: u64,
    pub(crate) total_ms: u64,
}

pub(crate) fn check(evidence: &Evidence) -> Report {
    let mut findings: Vec<Finding> = Vec::new();

    // Anti-bot: the header pass runs on any fetch; script/selector/
    // window-global probes need the rendered page, so the check is
    // partial until render evidence exists.
    for signature in signatures() {
        let Some(matched) = match_headers(&evidence.headers, signature) else {
            continue;
        };
        findings.push(Finding {
            kind: "antibot",
            severity: Severity::Warns,
            detail: matched.detail,
            evidence: json!({ "signal": matched.header, "source": "response-header" }),
        });
    }

    let rate_limit = detect_rate_limit(&evidence.headers, evidence.status);
    if rate_limit.detected {
        let actively_limited = evidence.status == Some(429);
        let severity = if actively_limited {
            Severity::Blocks
        } else {
            Severity::Warns
        };
        let detail = if actively_limited {
            "HTTP 429: rate limited right now".to_string()
        } else {
            "Rate-limit headers advertised".to_string()
        };
        findings.push(Finding {
            kind: "rate_limit",
            severity,
            detail,
            evidence: json!({
                "limit": rate_limit.limit,
                "remaining": rate_limit.remaining,
                "reset": rate_limit.reset,
                "retry_after": rate_limit.retry_after,
                "status": evidence.status,
            }),
        });
    }

    let robots_status = check_robots(evidence, &mut findings);

    let auth = detect_authentication(evidence.status, &evidence.final_url);
    if auth.required {
        findings.push(Finding {
            kind: "auth",
            severity: Severity::Blocks,
            detail: "Authentication required".to_string(),
            evidence: json!({ "indicators": auth.indicators }),
        });
    }

    let checks = Checks {
        antibot: CheckStatus::Partial,
        rate_limit: CheckStatus::Ran,
        robots: robots_status,
        auth: CheckStatus::Partial,
    };
    let checks_skipped = skipped_names(&checks);
    let verdict = decide(&findings, &checks_skipped);

    Report {
        schema: 1,
        url: evidence.url.clone(),
        final_url: evidence.final_url.clone(),
        status: evidence.status,
        title: extract_title(&evidence.body_html),
        verdict,
        findings,
        checks,
        checks_skipped,
        console_errors: Vec::new(),
        screenshot: None,
        timing_ms: Timing {
            fetch: evidence.fetch_ms,
            render: None,
            total: evidence.total_ms,
        },
    }
}

fn check_robots(evidence: &Evidence, findings: &mut Vec<Finding>) -> CheckStatus {
    let Some(body) = &evidence.robots_body else {
        // no robots.txt is an answer, not a failure: nothing forbids
        return CheckStatus::Ran;
    };
    let Ok(parsed_url) = url::Url::parse(&evidence.url) else {
        return CheckStatus::Skipped;
    };
    let info = parse_robots_txt(body, parsed_url.path());
    if info.allows_crawling {
        return CheckStatus::Ran;
    }
    let rule = info
        .disallowed_paths
        .iter()
        .find(|p| super::robots::matches_robots_pattern(p, parsed_url.path()))
        .cloned()
        .unwrap_or_default();
    findings.push(Finding {
        kind: "robots",
        severity: Severity::Blocks,
        detail: format!("Disallow: {rule} for User-agent: *"),
        evidence: json!({ "rule": format!("Disallow: {rule}"), "agent": "*" }),
    });
    CheckStatus::Ran
}

/// `clear` requires completeness; `restricted` does not. A positive
/// finding does not need every check to have run — a negative one does.
fn decide(findings: &[Finding], checks_skipped: &[String]) -> Verdict {
    if !findings.is_empty() {
        return Verdict::Restricted;
    }
    if checks_skipped.is_empty() {
        return Verdict::Clear;
    }
    Verdict::Inconclusive
}

fn skipped_names(checks: &Checks) -> Vec<String> {
    let mut names = Vec::new();
    for (name, status) in [
        ("antibot", checks.antibot),
        ("rate_limit", checks.rate_limit),
        ("robots", checks.robots),
        ("auth", checks.auth),
    ] {
        if status != CheckStatus::Ran {
            names.push(name.to_string());
        }
    }
    names
}

/// Raw-HTML `<title>` extraction — best-effort, honest about its source:
/// no render means no post-JS title.
fn extract_title(html: &str) -> Option<String> {
    let lower = html.to_lowercase();
    let open = lower.find("<title")?;
    let after_open = open + lower[open..].find('>')? + 1;
    let close = after_open + lower[after_open..].find("</title>")?;
    let title = html.get(after_open..close)?.trim();
    if title.is_empty() {
        return None;
    }
    Some(title.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn evidence(status: u16, headers: &[(&str, &str)], robots: Option<&str>) -> Evidence {
        Evidence {
            url: "https://example.com/search?q=x".to_string(),
            final_url: "https://example.com/search?q=x".to_string(),
            status: Some(status),
            headers: headers
                .iter()
                .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
                .collect(),
            body_html: "<html><title>Search — Example</title></html>".to_string(),
            robots_body: robots.map(str::to_string),
            fetch_ms: 10,
            total_ms: 12,
        }
    }

    #[test]
    fn clean_fetch_without_render_is_inconclusive_never_clear() {
        let report = check(&evidence(200, &[], None));
        assert_eq!(report.verdict, Verdict::Inconclusive);
        assert!(report.findings.is_empty());
        assert_eq!(report.checks_skipped, ["antibot", "auth"]);
    }

    #[test]
    fn robots_disallow_blocks_and_names_the_rule() {
        let robots = "User-agent: *\nDisallow: /search";
        let report = check(&evidence(200, &[], Some(robots)));
        assert_eq!(report.verdict, Verdict::Restricted);
        let finding = &report.findings[0];
        assert_eq!(finding.kind, "robots");
        assert_eq!(finding.severity, Severity::Blocks);
        assert_eq!(finding.detail, "Disallow: /search for User-agent: *");
    }

    #[test]
    fn cloudflare_header_warns_with_evidence() {
        let report = check(&evidence(200, &[("cf-ray", "8abc-EWR")], None));
        assert_eq!(report.verdict, Verdict::Restricted);
        let finding = &report.findings[0];
        assert_eq!(finding.kind, "antibot");
        assert_eq!(finding.detail, "Cloudflare (cf-ray header)");
        assert_eq!(finding.evidence["signal"], "cf-ray");
    }

    #[test]
    fn status_429_blocks() {
        let report = check(&evidence(429, &[], None));
        let finding = report
            .findings
            .iter()
            .find(|f| f.kind == "rate_limit")
            .expect("rate_limit finding");
        assert_eq!(finding.severity, Severity::Blocks);
    }

    #[test]
    fn status_401_blocks_via_auth() {
        let report = check(&evidence(401, &[], None));
        let finding = report
            .findings
            .iter()
            .find(|f| f.kind == "auth")
            .expect("auth finding");
        assert_eq!(finding.severity, Severity::Blocks);
        assert_eq!(report.verdict, Verdict::Restricted);
    }

    #[test]
    fn title_extracted_from_raw_html() {
        let report = check(&evidence(200, &[], None));
        assert_eq!(report.title.as_deref(), Some("Search — Example"));
    }

    #[test]
    fn no_single_warns_finding_produces_blocked() {
        let report = check(&evidence(200, &[("cf-ray", "x")], None));
        assert_ne!(report.verdict, Verdict::Blocked);
    }
}
