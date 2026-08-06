//! robots.txt parsing and matching — the port of the extension's
//! `src/detectors/robotstxt.ts`.
//!
//! Flagless behaviour is the extension's, exactly: only the generic
//! (`User-agent: *`) groups are evaluated, and `fixtures/robots/cases.json`
//! pins the results. Passing an agent selects that agent's groups per
//! RFC 9309 instead — the documented divergence, opt-in, recorded in
//! the report so a reader knows which rules answered.

use regex::Regex;

#[derive(Debug, PartialEq)]
pub(crate) struct RobotsTxtInfo {
    pub(crate) exists: bool,
    pub(crate) allows_crawling: bool,
    pub(crate) crawl_delay: Option<f64>,
    pub(crate) disallowed_paths: Vec<String>,
    pub(crate) sitemaps: Vec<String>,
    /// which group answered: `*`, or the agent token that matched
    pub(crate) agent: String,
    /// the rule that decided a refusal, when one did
    pub(crate) matched_rule: Option<String>,
}

struct RobotsRule {
    allow: bool,
    pattern: String,
}

struct Group {
    agents: Vec<String>,
    rules: Vec<RobotsRule>,
    crawl_delay: Option<f64>,
}

/// Parses robots.txt and evaluates `pathname` against the rules that
/// apply. `agent` is the caller's product token (`MyBot/1.0` → `mybot`);
/// `None` evaluates the generic rules only, as the extension does.
pub(crate) fn parse_robots_txt(
    content: &str,
    pathname: &str,
    agent: Option<&str>,
) -> RobotsTxtInfo {
    let (groups, sitemaps) = parse_groups(content);
    let token = agent.map(product_token);

    // An agent-specific group wins; with no match — or no agent — the
    // generic groups answer, which is RFC 9309 and also the extension's
    // only behaviour.
    let (selected, answering_agent) = match token.as_deref() {
        Some(token) if groups.iter().any(|g| g.agents.iter().any(|a| a == token)) => {
            (select(&groups, token), token.to_string())
        }
        _ => (select(&groups, "*"), "*".to_string()),
    };

    let rules: Vec<&RobotsRule> = selected.iter().flat_map(|g| g.rules.iter()).collect();
    let crawl_delay = selected.iter().find_map(|g| g.crawl_delay);
    let decision = decide_path(pathname, &rules);

    RobotsTxtInfo {
        exists: true,
        allows_crawling: decision.allowed,
        crawl_delay,
        disallowed_paths: rules
            .iter()
            .filter(|r| !r.allow)
            .map(|r| r.pattern.clone())
            .collect(),
        sitemaps,
        agent: answering_agent,
        matched_rule: decision.matched,
    }
}

fn select<'a>(groups: &'a [Group], token: &str) -> Vec<&'a Group> {
    groups
        .iter()
        .filter(|g| g.agents.iter().any(|a| a == token))
        .collect()
}

/// `MyBot/1.0` → `mybot`. RFC 9309 matches the product token,
/// case-insensitively, ignoring any version suffix.
fn product_token(agent: &str) -> String {
    agent
        .split('/')
        .next()
        .unwrap_or(agent)
        .trim()
        .to_lowercase()
}

fn parse_groups(content: &str) -> (Vec<Group>, Vec<String>) {
    let mut groups: Vec<Group> = Vec::new();
    let mut sitemaps: Vec<String> = Vec::new();
    let mut agents: Vec<String> = Vec::new();
    let mut in_group_header = false;

    for raw_line in content.split('\n') {
        // comments run from '#' to end of line
        let line = match raw_line.find('#') {
            Some(hash_index) => &raw_line[..hash_index],
            None => raw_line,
        }
        .trim();
        if line.is_empty() {
            continue;
        }

        let Some(colon_index) = line.find(':') else {
            continue;
        };
        let directive = line[..colon_index].trim().to_lowercase();
        let value = line[colon_index + 1..].trim();

        if directive == "user-agent" {
            if !in_group_header {
                agents = Vec::new();
                in_group_header = true;
                groups.push(Group {
                    agents: Vec::new(),
                    rules: Vec::new(),
                    crawl_delay: None,
                });
            }
            agents.push(value.to_lowercase());
            if let Some(group) = groups.last_mut() {
                group.agents.clone_from(&agents);
            }
            continue;
        }

        // any non-user-agent directive closes the group header
        in_group_header = false;

        if directive == "sitemap" {
            // sitemap is not group-scoped
            if !value.is_empty() {
                sitemaps.push(value.to_string());
            }
            continue;
        }

        let Some(group) = groups.last_mut() else {
            continue;
        };

        if (directive == "disallow" || directive == "allow") && !value.is_empty() {
            group.rules.push(RobotsRule {
                allow: directive == "allow",
                pattern: value.to_string(),
            });
            continue;
        }

        if directive == "crawl-delay" {
            let Some(delay) = js_parse_float(value) else {
                continue;
            };
            if delay >= 0.0 {
                group.crawl_delay = Some(delay);
            }
        }
    }

    (groups, sitemaps)
}

struct Decision {
    allowed: bool,
    matched: Option<String>,
}

/// RFC 9309 matching: longest matching pattern wins, Allow wins ties;
/// no matching rule means allowed.
fn decide_path(pathname: &str, rules: &[&RobotsRule]) -> Decision {
    let mut best_length: i64 = -1;
    let mut best_allow = true;
    let mut best_pattern: Option<String> = None;

    for rule in rules {
        if !matches_robots_pattern(&rule.pattern, pathname) {
            continue;
        }
        let length = rule.pattern.len() as i64;
        let wins_tie = length == best_length && rule.allow && !best_allow;
        if length > best_length || wins_tie {
            best_length = length;
            best_allow = rule.allow;
            best_pattern = Some(rule.pattern.clone());
        }
    }

    Decision {
        allowed: best_allow,
        matched: if best_allow { None } else { best_pattern },
    }
}

/// Matches a robots.txt pattern against a path: anchored at the start,
/// `*` matches any character sequence, a trailing `$` anchors the end.
/// Built the same way the extension builds it, so the two cannot
/// disagree about an edge.
pub(crate) fn matches_robots_pattern(pattern: &str, pathname: &str) -> bool {
    let anchored = pattern.ends_with('$');
    let body = if anchored {
        &pattern[..pattern.len() - 1]
    } else {
        pattern
    };

    let escaped = body
        .split('*')
        .map(regex::escape)
        .collect::<Vec<_>>()
        .join("[\\s\\S]*");

    let end = if anchored { "$" } else { "" };
    let Ok(re) = Regex::new(&format!("^{escaped}{end}")) else {
        return false;
    };
    re.is_match(pathname)
}

/// JS `Number.parseFloat` semantics: the longest numeric prefix parses,
/// so `10` and `10s` are both 10 and `not-a-number` is `None`.
fn js_parse_float(value: &str) -> Option<f64> {
    for end in (1..=value.len()).rev() {
        let Some(prefix) = value.get(..end) else {
            continue;
        };
        let Ok(parsed) = prefix.parse::<f64>() else {
            continue;
        };
        if parsed.is_nan() {
            return None;
        }
        return Some(parsed);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    const CASES: &str = include_str!("../../../fixtures/robots/cases.json");

    fn fixture_body(file: &str) -> &'static str {
        match file {
            "simple.txt" => include_str!("../../../fixtures/robots/simple.txt"),
            "disallow-all.txt" => include_str!("../../../fixtures/robots/disallow-all.txt"),
            "wildcards.txt" => include_str!("../../../fixtures/robots/wildcards.txt"),
            "multi-group.txt" => include_str!("../../../fixtures/robots/multi-group.txt"),
            "agent-specific.txt" => include_str!("../../../fixtures/robots/agent-specific.txt"),
            other => panic!("fixture body {other} not embedded — add it here"),
        }
    }

    #[test]
    fn every_fixture_case_reproduces() {
        let cases: serde_json::Value = serde_json::from_str(CASES).expect("fixture JSON");
        for case in cases.as_array().expect("array of cases") {
            let name = case["name"].as_str().expect("name");
            let body = fixture_body(case["file"].as_str().expect("file"));
            let path = case["path"].as_str().expect("path");
            let expected = &case["expected"];

            let actual = parse_robots_txt(body, path, None);

            assert_eq!(
                actual.exists,
                expected["exists"].as_bool().expect("exists"),
                "case {name:?}: exists"
            );
            assert_eq!(
                actual.allows_crawling,
                expected["allowsCrawling"]
                    .as_bool()
                    .expect("allowsCrawling"),
                "case {name:?}: allowsCrawling"
            );
            assert_eq!(
                actual.crawl_delay,
                expected["crawlDelay"].as_f64(),
                "case {name:?}: crawlDelay"
            );
            let expected_disallowed: Vec<String> =
                serde_json::from_value(expected["disallowedPaths"].clone())
                    .expect("disallowedPaths");
            assert_eq!(
                actual.disallowed_paths, expected_disallowed,
                "case {name:?}: disallowedPaths"
            );
            let expected_sitemaps: Vec<String> =
                serde_json::from_value(expected["sitemaps"].clone()).expect("sitemaps");
            assert_eq!(
                actual.sitemaps, expected_sitemaps,
                "case {name:?}: sitemaps"
            );
        }
    }

    /// The divergence annotations are a contract too: where a fixture
    /// records what the CLI answers with `--agent`, the CLI must
    /// actually answer that.
    #[test]
    fn every_divergence_annotation_holds() {
        let cases: serde_json::Value = serde_json::from_str(CASES).expect("fixture JSON");
        let mut checked = 0;
        for case in cases.as_array().expect("array of cases") {
            let Some(divergence) = case.get("divergence") else {
                continue;
            };
            let name = case["name"].as_str().expect("name");
            let body = fixture_body(case["file"].as_str().expect("file"));
            let path = case["path"].as_str().expect("path");
            let agent = divergence["cli"]["agent"].as_str().expect("cli agent");
            let expected = divergence["cli"]["allowsCrawling"]
                .as_bool()
                .expect("cli allowsCrawling");

            let actual = parse_robots_txt(body, path, Some(agent));
            assert_eq!(
                actual.allows_crawling, expected,
                "divergence {name:?} with --agent {agent}"
            );
            assert_eq!(actual.agent, agent.to_lowercase());
            checked += 1;
        }
        assert!(checked >= 2, "expected divergence cases to exist");
    }

    #[test]
    fn unknown_agent_falls_back_to_the_generic_group() {
        let body = fixture_body("agent-specific.txt");
        let info = parse_robots_txt(body, "/members/area", Some("NobodyBot/2.0"));
        assert!(info.allows_crawling);
        assert_eq!(info.agent, "*");
    }

    #[test]
    fn agent_matching_ignores_case_and_version() {
        let body = "User-agent: MyBot\nDisallow: /x\n";
        let info = parse_robots_txt(body, "/x", Some("mybot/9.9"));
        assert!(!info.allows_crawling);
        assert_eq!(info.agent, "mybot");
    }

    #[test]
    fn refusal_names_the_rule_that_decided_it() {
        let body = "User-agent: *\nDisallow: /search\n";
        let info = parse_robots_txt(body, "/search?q=1", None);
        assert!(!info.allows_crawling);
        assert_eq!(info.matched_rule.as_deref(), Some("/search"));
    }

    #[test]
    fn allowed_paths_name_no_rule() {
        let body = "User-agent: *\nDisallow: /search\n";
        let info = parse_robots_txt(body, "/about", None);
        assert!(info.allows_crawling);
        assert_eq!(info.matched_rule, None);
    }

    #[test]
    fn pattern_matching_edges() {
        assert!(matches_robots_pattern("/admin/", "/admin/settings"));
        assert!(!matches_robots_pattern("/admin/", "/admin"));
        assert!(matches_robots_pattern("/*.json$", "/data.json"));
        assert!(!matches_robots_pattern("/*.json$", "/data.json?x=1"));
        assert!(matches_robots_pattern("/private*", "/private/file"));
        assert!(matches_robots_pattern("/", "/anything"));
    }
}
