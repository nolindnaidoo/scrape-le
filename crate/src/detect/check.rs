//! `check()` — evidence in, report out. Both surfaces call this and
//! nothing else, so neither can grow its own copy of a rule. Pure:
//! `fetch.rs` and `render.rs` gather the evidence, this decides.

use std::collections::HashMap;

use serde_json::json;

use super::antibot::match_headers;
use super::auth::detect_authentication;
use super::ratelimit::detect_rate_limit;
use super::report::{
    CheckStatus, Checks, Finding, Report, RobotsReport, Severity, Timing, Verdict,
};
use super::robots::parse_robots_txt;
use super::signatures::signatures;

/// What a fetch produced. `robots_body` is `None` when robots.txt did
/// not exist or was unreachable — distinct from an empty file.
pub(crate) struct Evidence {
    pub(crate) url: String,
    pub(crate) final_url: String,
    pub(crate) status: Option<u16>,
    /// lowercased header names, as delivered
    pub(crate) headers: HashMap<String, String>,
    pub(crate) body_html: String,
    pub(crate) robots_body: Option<String>,
    pub(crate) render: Option<RenderEvidence>,
    pub(crate) fetch_ms: u64,
    pub(crate) total_ms: u64,
}

/// What only a rendered page can show. Present ⇒ the antibot and auth
/// checks ran completely and `clear` becomes reachable. `status` and
/// `headers` come from the document's own CDP response, so a rendered
/// check needs no second request to the site.
pub(crate) struct RenderEvidence {
    pub(crate) final_url: Option<String>,
    pub(crate) title: Option<String>,
    pub(crate) body_html: String,
    pub(crate) status: Option<u16>,
    pub(crate) headers: Option<HashMap<String, String>>,
    /// per vendor key, the extension's single-evaluate probe result
    pub(crate) probes: HashMap<String, ProbeResult>,
    pub(crate) auth: AuthPageEvidence,
    pub(crate) console_errors: Vec<String>,
    pub(crate) screenshot: Option<String>,
    pub(crate) render_ms: u64,
}

impl Evidence {
    /// Evidence from a render alone: no HTTP fetch of the page ever
    /// happened, so everything but robots.txt comes from the browser.
    pub(crate) fn from_render(
        url: &str,
        render: RenderEvidence,
        robots_body: Option<String>,
    ) -> Self {
        Self {
            url: url.to_string(),
            final_url: render.final_url.clone().unwrap_or_else(|| url.to_string()),
            status: render.status,
            headers: render.headers.clone().unwrap_or_default(),
            body_html: render.body_html.clone(),
            robots_body,
            render: Some(render),
            fetch_ms: 0,
            total_ms: 0,
        }
    }
}

pub(crate) struct ProbeResult {
    pub(crate) script: bool,
    pub(crate) selector: bool,
    pub(crate) global: bool,
}

pub(crate) struct AuthPageEvidence {
    pub(crate) has_password_input: bool,
    pub(crate) has_form: bool,
    pub(crate) has_username_input: bool,
    pub(crate) form_action: Option<String>,
    pub(crate) keyword: Option<String>,
}

/// Caller-supplied knobs the decision layer needs. Defaults are the
/// extension's behaviour: generic robots groups, no batch index.
#[derive(Debug, Default, Clone)]
pub(crate) struct CheckOptions {
    /// RFC 9309 product token to evaluate robots.txt against; `None`
    /// evaluates the generic (`User-agent: *`) rules only
    pub(crate) agent: Option<String>,
    /// the URL's position in a batch input
    pub(crate) index: Option<usize>,
}

pub(crate) fn check(evidence: &Evidence, options: &CheckOptions) -> Report {
    let mut findings: Vec<Finding> = Vec::new();

    check_antibot(evidence, &mut findings);
    check_rate_limit(evidence, &mut findings);
    let (robots_status, robots) = check_robots(evidence, options, &mut findings);
    check_auth(evidence, &mut findings);

    let rendered = evidence.render.is_some();
    let dom_status = if rendered {
        CheckStatus::Ran
    } else {
        CheckStatus::Partial
    };
    let checks = Checks {
        antibot: dom_status,
        rate_limit: CheckStatus::Ran,
        robots: robots_status,
        auth: dom_status,
    };
    let checks_skipped = skipped_names(&checks);
    let verdict = decide(&findings, &checks_skipped);

    let render = evidence.render.as_ref();
    let final_url = render
        .and_then(|r| r.final_url.clone())
        .unwrap_or_else(|| evidence.final_url.clone());
    let title = render
        .and_then(|r| r.title.clone())
        .or_else(|| extract_title(&evidence.body_html));

    Report {
        schema: 1,
        index: options.index,
        url: evidence.url.clone(),
        final_url,
        status: evidence.status,
        title,
        verdict,
        findings,
        checks,
        checks_skipped,
        robots,
        console_errors: render.map(|r| r.console_errors.clone()).unwrap_or_default(),
        screenshot: render.and_then(|r| r.screenshot.clone()),
        timing_ms: Timing {
            fetch: evidence.fetch_ms,
            render: render.map(|r| r.render_ms),
            total: evidence.total_ms,
        },
    }
}

/// One header pass, then the page-probe pass for vendors the headers
/// did not already name — the extension's order, so the reported
/// evidence label is the same one it would print.
fn check_antibot(evidence: &Evidence, findings: &mut Vec<Finding>) {
    let mut detected: Vec<&str> = Vec::new();
    for signature in signatures() {
        let Some(matched) = match_headers(&evidence.headers, signature) else {
            continue;
        };
        detected.push(&signature.key);
        findings.push(Finding {
            kind: "antibot".to_string(),
            severity: Severity::Warns,
            detail: matched.detail,
            evidence: json!({ "signal": matched.header, "source": "response-header" }),
        });
    }
    let Some(render) = &evidence.render else {
        return;
    };
    for signature in signatures() {
        if detected.contains(&signature.key.as_str()) {
            continue;
        }
        let Some(probe) = render.probes.get(&signature.key) else {
            continue;
        };
        // First matching evidence wins, so the label names how it was
        // found — same precedence as the extension.
        let source = if probe.script {
            "script src"
        } else if probe.selector {
            "DOM element"
        } else if probe.global {
            "window global"
        } else {
            continue;
        };
        findings.push(Finding {
            kind: "antibot".to_string(),
            severity: Severity::Warns,
            detail: format!("{} ({source})", signature.label),
            evidence: json!({ "source": source }),
        });
    }
}

fn check_rate_limit(evidence: &Evidence, findings: &mut Vec<Finding>) {
    let rate_limit = detect_rate_limit(&evidence.headers, evidence.status);
    if !rate_limit.detected {
        return;
    }
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
        kind: "rate_limit".to_string(),
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

fn check_robots(
    evidence: &Evidence,
    options: &CheckOptions,
    findings: &mut Vec<Finding>,
) -> (CheckStatus, Option<RobotsReport>) {
    let Some(body) = &evidence.robots_body else {
        // no robots.txt is an answer, not a failure: nothing forbids
        return (
            CheckStatus::Ran,
            Some(RobotsReport {
                exists: false,
                allows_crawling: true,
                agent: options.agent.clone().unwrap_or_else(|| "*".to_string()),
                crawl_delay: None,
                disallowed_paths: Vec::new(),
                sitemaps: Vec::new(),
            }),
        );
    };
    let Ok(parsed_url) = url::Url::parse(&evidence.url) else {
        return (CheckStatus::Skipped, None);
    };
    let info = parse_robots_txt(body, parsed_url.path(), options.agent.as_deref());
    let report = RobotsReport {
        exists: info.exists,
        allows_crawling: info.allows_crawling,
        agent: info.agent.clone(),
        crawl_delay: info.crawl_delay,
        disallowed_paths: info.disallowed_paths.clone(),
        sitemaps: info.sitemaps.clone(),
    };
    if info.allows_crawling {
        return (CheckStatus::Ran, Some(report));
    }
    let rule = info.matched_rule.clone().unwrap_or_default();
    findings.push(Finding {
        kind: "robots".to_string(),
        severity: Severity::Blocks,
        detail: format!("Disallow: {rule} for User-agent: {}", info.agent),
        evidence: json!({ "rule": format!("Disallow: {rule}"), "agent": info.agent }),
    });
    (CheckStatus::Ran, Some(report))
}

fn check_auth(evidence: &Evidence, findings: &mut Vec<Finding>) {
    let final_url = evidence
        .render
        .as_ref()
        .and_then(|r| r.final_url.as_deref())
        .unwrap_or(&evidence.final_url);
    let page = evidence.render.as_ref().map(|r| &r.auth);
    let auth = detect_authentication(evidence.status, final_url, page);
    if !auth.required {
        return;
    }
    findings.push(Finding {
        kind: "auth".to_string(),
        severity: Severity::Blocks,
        detail: "Authentication required".to_string(),
        evidence: json!({
            "indicators": auth.indicators,
            "type": auth.auth_type,
            "login_url": auth.login_url,
            "paired_username": auth.paired_username,
        }),
    });
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

/// Raw-HTML `<title>` extraction — the fallback when no render ran.
///
/// **`to_ascii_lowercase`, not `to_lowercase`.** The offsets below are
/// found in the lowered copy and used to slice the original, and
/// `to_lowercase` is not length-preserving: `\u{130}` grows a byte and
/// `\u{212a}` shrinks one, so a page carrying either before its title
/// slid every offset and the slice landed inside a character. Tag names
/// are ASCII, so the ASCII fold is both correct and the same length.
fn extract_title(html: &str) -> Option<String> {
    let lower = html.to_ascii_lowercase();
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
            render: None,
            fetch_ms: 10,
            total_ms: 12,
        }
    }

    fn clean_render() -> RenderEvidence {
        RenderEvidence {
            final_url: Some("https://example.com/search?q=x".to_string()),
            title: Some("Search — Example".to_string()),
            body_html: "<html><title>Search — Example</title></html>".to_string(),
            status: Some(200),
            headers: Some(HashMap::new()),
            probes: HashMap::new(),
            auth: AuthPageEvidence {
                has_password_input: false,
                has_form: false,
                has_username_input: false,
                form_action: None,
                keyword: None,
            },
            console_errors: Vec::new(),
            screenshot: Some("./scrape-le-example-com-2026-08-06.png".to_string()),
            render_ms: 1500,
        }
    }

    #[test]
    fn clean_fetch_without_render_is_inconclusive_never_clear() {
        let report = check(&evidence(200, &[], None), &CheckOptions::default());
        assert_eq!(report.verdict, Verdict::Inconclusive);
        assert!(report.findings.is_empty());
        assert_eq!(report.checks_skipped, ["antibot", "auth"]);
    }

    #[test]
    fn clean_rendered_run_is_clear() {
        let mut e = evidence(200, &[], None);
        e.render = Some(clean_render());
        let report = check(&e, &CheckOptions::default());
        assert_eq!(report.verdict, Verdict::Clear);
        assert!(report.checks_skipped.is_empty());
        assert_eq!(report.timing_ms.render, Some(1500));
        assert!(report.screenshot.is_some());
    }

    #[test]
    fn page_probe_warns_with_the_extension_precedence() {
        let mut e = evidence(200, &[], None);
        let mut render = clean_render();
        render.probes.insert(
            "recaptcha".to_string(),
            ProbeResult {
                script: true,
                selector: true,
                global: true,
            },
        );
        e.render = Some(render);
        let report = check(&e, &CheckOptions::default());
        assert_eq!(report.verdict, Verdict::Restricted);
        let finding = &report.findings[0];
        assert_eq!(finding.detail, "reCAPTCHA (script src)");
    }

    #[test]
    fn header_match_wins_over_probe_for_the_same_vendor() {
        let mut e = evidence(200, &[("cf-ray", "8abc-EWR")], None);
        let mut render = clean_render();
        render.probes.insert(
            "cloudflare".to_string(),
            ProbeResult {
                script: false,
                selector: false,
                global: true,
            },
        );
        e.render = Some(render);
        let report = check(&e, &CheckOptions::default());
        let antibot: Vec<&Finding> = report
            .findings
            .iter()
            .filter(|f| f.kind == "antibot")
            .collect();
        assert_eq!(antibot.len(), 1);
        assert_eq!(antibot[0].detail, "Cloudflare (cf-ray header)");
    }

    #[test]
    fn login_form_blocks_on_a_rendered_page() {
        let mut e = evidence(200, &[], None);
        let mut render = clean_render();
        render.auth.has_password_input = true;
        render.auth.has_form = true;
        render.auth.form_action = Some("https://example.com/session".to_string());
        e.render = Some(render);
        let report = check(&e, &CheckOptions::default());
        let finding = report
            .findings
            .iter()
            .find(|f| f.kind == "auth")
            .expect("auth finding");
        assert_eq!(finding.severity, Severity::Blocks);
        assert_eq!(finding.evidence["login_url"], "https://example.com/session");
    }

    #[test]
    fn robots_disallow_blocks_and_names_the_rule() {
        let robots = "User-agent: *\nDisallow: /search";
        let report = check(&evidence(200, &[], Some(robots)), &CheckOptions::default());
        assert_eq!(report.verdict, Verdict::Restricted);
        let finding = &report.findings[0];
        assert_eq!(finding.kind, "robots");
        assert_eq!(finding.severity, Severity::Blocks);
        assert_eq!(finding.detail, "Disallow: /search for User-agent: *");
    }

    #[test]
    fn cloudflare_header_warns_with_evidence() {
        let report = check(
            &evidence(200, &[("cf-ray", "8abc-EWR")], None),
            &CheckOptions::default(),
        );
        assert_eq!(report.verdict, Verdict::Restricted);
        let finding = &report.findings[0];
        assert_eq!(finding.kind, "antibot");
        assert_eq!(finding.detail, "Cloudflare (cf-ray header)");
        assert_eq!(finding.evidence["signal"], "cf-ray");
    }

    #[test]
    fn status_429_blocks() {
        let report = check(&evidence(429, &[], None), &CheckOptions::default());
        let finding = report
            .findings
            .iter()
            .find(|f| f.kind == "rate_limit")
            .expect("rate_limit finding");
        assert_eq!(finding.severity, Severity::Blocks);
    }

    #[test]
    fn status_401_blocks_via_auth() {
        let report = check(&evidence(401, &[], None), &CheckOptions::default());
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
        let report = check(&evidence(200, &[], None), &CheckOptions::default());
        assert_eq!(report.title.as_deref(), Some("Search — Example"));
    }

    /// **Regression.** The offsets are found in a lowered copy and used
    /// against the original, so the fold has to preserve length.
    /// `to_lowercase` does not: U+0130 grows a byte and U+212A shrinks
    /// one, and a page carrying either before its title slid every
    /// offset until the slice landed inside a character.
    #[test]
    fn a_title_survives_characters_that_change_length_when_lowered() {
        for marker in ['\u{130}', '\u{212a}', '\u{1e9e}'] {
            let mut e = evidence(200, &[], None);
            e.body_html =
                format!("<html><body>{marker}</body><title>Search — Example</title></html>");
            let report = check(&e, &CheckOptions::default());
            assert_eq!(
                report.title.as_deref(),
                Some("Search — Example"),
                "a {marker:?} before the title moved the slice"
            );
        }
    }

    /// Tag names are ASCII, so the fold only has to reach them.
    #[test]
    fn an_upper_case_title_tag_is_still_found() {
        let mut e = evidence(200, &[], None);
        e.body_html = "<HTML><TITLE>Search — Example</TITLE></HTML>".to_string();
        let report = check(&e, &CheckOptions::default());
        assert_eq!(report.title.as_deref(), Some("Search — Example"));
    }

    /// The verdict rules, held over every combination rather than the
    /// cases someone thought of:
    ///
    /// - `clear` requires zero findings **and** zero skipped checks;
    /// - no set of `warns` findings ever produces `blocked` — that
    ///   verdict belongs to a page that could not be reached at all;
    /// - a positive finding does not need completeness, so a partial
    ///   run can still say `restricted` honestly.
    #[test]
    fn the_verdict_rules_hold_over_every_combination() {
        let statuses = [CheckStatus::Ran, CheckStatus::Partial, CheckStatus::Skipped];
        for antibot in statuses {
            for auth in statuses {
                for robots in statuses {
                    for finding_count in 0..3 {
                        for severity in [Severity::Warns, Severity::Blocks] {
                            let findings: Vec<Finding> = (0..finding_count)
                                .map(|i| Finding {
                                    kind: "antibot".to_string(),
                                    severity,
                                    detail: format!("probe {i}"),
                                    evidence: json!({}),
                                })
                                .collect();
                            let checks = Checks {
                                antibot,
                                rate_limit: CheckStatus::Ran,
                                robots,
                                auth,
                            };
                            let skipped = skipped_names(&checks);
                            let verdict = decide(&findings, &skipped);

                            assert_ne!(
                                verdict,
                                Verdict::Blocked,
                                "findings alone must never produce blocked"
                            );
                            if verdict == Verdict::Clear {
                                assert!(findings.is_empty(), "clear with findings");
                                assert!(skipped.is_empty(), "clear with skipped checks");
                            }
                            if !findings.is_empty() {
                                assert_eq!(
                                    verdict,
                                    Verdict::Restricted,
                                    "a positive finding stands without completeness"
                                );
                            }
                            if findings.is_empty() && !skipped.is_empty() {
                                assert_eq!(verdict, Verdict::Inconclusive);
                            }
                        }
                    }
                }
            }
        }
    }

    /// **The coverage matrix.** The extractor crates in this family
    /// answer "does it open what it claims?" with one file per extension
    /// in their alias table. This crate has no format table; what it
    /// claims is **five anti-bot vendors, four checks and four
    /// verdicts**, so that is the table.
    ///
    /// Every vendor must be reachable through every kind of signal it
    /// declares. A vendor listed in the corpus that no evidence can
    /// surface is the same failure as a format in the table with no
    /// corpus document: it inflates what the tool says it covers.
    #[test]
    fn coverage_matrix_every_vendor_is_reachable_through_every_signal_it_declares() {
        let mut reached = 0;
        for signature in signatures() {
            // Headers, where the vendor declares any.
            for header in &signature.headers {
                let value = header
                    .contains
                    .clone()
                    .unwrap_or_else(|| "probe-value".to_string());
                let report = check(
                    &evidence(200, &[(&header.name, &value)], None),
                    &CheckOptions::default(),
                );
                let finding = report
                    .findings
                    .iter()
                    .find(|f| f.kind == "antibot" && f.detail.starts_with(&signature.label))
                    .unwrap_or_else(|| {
                        panic!(
                            "{}: the {} header names no vendor",
                            signature.key, header.name
                        )
                    });
                assert_eq!(finding.evidence["source"], "response-header");
                reached += 1;
            }

            // The page probe, once per source the vendor declares.
            for (source, declared) in [
                ("script src", !signature.script_substrings.is_empty()),
                ("DOM element", !signature.selectors.is_empty()),
                ("window global", !signature.globals.is_empty()),
            ] {
                if !declared {
                    continue;
                }
                let mut e = evidence(200, &[], None);
                let mut render = clean_render();
                render.probes.insert(
                    signature.key.clone(),
                    ProbeResult {
                        script: source == "script src",
                        selector: source == "DOM element",
                        global: source == "window global",
                    },
                );
                e.render = Some(render);
                let report = check(&e, &CheckOptions::default());
                assert!(
                    report
                        .findings
                        .iter()
                        .any(|f| f.detail == format!("{} ({source})", signature.label)),
                    "{}: a {source} signal names no vendor",
                    signature.key
                );
                reached += 1;
            }
        }
        // Not vacuous: an empty corpus would satisfy every loop above.
        assert!(
            reached >= 5,
            "only {reached} vendor signals were reachable, which is too few to be a matrix"
        );
        eprintln!("coverage-matrix: {reached} vendor signals reachable through check()");
    }

    /// Every check the report names, and every verdict it can carry,
    /// reachable from evidence. A verdict nothing can produce is a
    /// documented state that never happens.
    #[test]
    fn coverage_matrix_every_check_and_every_verdict_is_reachable() {
        let mut rendered = evidence(200, &[], None);
        rendered.render = Some(clean_render());
        assert_eq!(
            check(&rendered, &CheckOptions::default()).verdict,
            Verdict::Clear
        );
        assert_eq!(
            check(&evidence(200, &[], None), &CheckOptions::default()).verdict,
            Verdict::Inconclusive
        );
        assert_eq!(
            check(&evidence(429, &[], None), &CheckOptions::default()).verdict,
            Verdict::Restricted
        );
        // `blocked` belongs to a page that could not be reached at all,
        // so it is built by the surfaces rather than by `check`.
        assert_eq!(
            crate::cli::blocked_report("https://example.com", "dns failure", None).verdict,
            Verdict::Blocked
        );

        let kinds = [
            (
                "antibot",
                check(
                    &evidence(200, &[("cf-ray", "x")], None),
                    &CheckOptions::default(),
                ),
            ),
            (
                "rate_limit",
                check(&evidence(429, &[], None), &CheckOptions::default()),
            ),
            (
                "robots",
                check(
                    &evidence(200, &[], Some("User-agent: *\nDisallow: /search")),
                    &CheckOptions::default(),
                ),
            ),
            (
                "auth",
                check(&evidence(401, &[], None), &CheckOptions::default()),
            ),
        ];
        for (kind, report) in kinds {
            assert!(
                report.findings.iter().any(|f| f.kind == kind),
                "the {kind} check produces no finding anything can trigger"
            );
        }
        eprintln!("coverage-matrix: 4 checks and 4 verdicts reachable");
    }

    #[test]
    fn no_single_warns_finding_produces_blocked() {
        let report = check(
            &evidence(200, &[("cf-ray", "x")], None),
            &CheckOptions::default(),
        );
        assert_ne!(report.verdict, Verdict::Blocked);
    }
}
