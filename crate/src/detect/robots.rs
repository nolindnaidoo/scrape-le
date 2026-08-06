//! robots.txt parsing and matching — the port of the extension's
//! `src/detectors/robotstxt.ts`, flagless semantics: the generic
//! (`User-agent: *`) rules only, RFC 9309 grouping and longest-match.
//! `fixtures/robots/cases.json` pins the results; `--agent` group
//! selection is the CLI's documented divergence and does not live here.

use regex::Regex;

#[derive(Debug, PartialEq)]
pub(crate) struct RobotsTxtInfo {
    pub(crate) exists: bool,
    pub(crate) allows_crawling: bool,
    pub(crate) crawl_delay: Option<f64>,
    pub(crate) disallowed_paths: Vec<String>,
    pub(crate) sitemaps: Vec<String>,
}

struct RobotsRule {
    allow: bool,
    pattern: String,
}

/// Parses robots.txt content against the generic (`User-agent: *`)
/// rules and evaluates `pathname` against them.
pub(crate) fn parse_robots_txt(content: &str, pathname: &str) -> RobotsTxtInfo {
    let mut rules: Vec<RobotsRule> = Vec::new();
    let mut sitemaps: Vec<String> = Vec::new();
    let mut crawl_delay: Option<f64> = None;

    let mut group_agents: Vec<String> = Vec::new();
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
                group_agents.clear();
                in_group_header = true;
            }
            group_agents.push(value.to_lowercase());
            continue;
        }

        // any non-user-agent directive closes the group header
        in_group_header = false;
        let group_applies_to_all = group_agents.iter().any(|agent| agent == "*");

        if directive == "sitemap" {
            // sitemap is not group-scoped
            if !value.is_empty() {
                sitemaps.push(value.to_string());
            }
            continue;
        }

        if !group_applies_to_all {
            continue;
        }

        if (directive == "disallow" || directive == "allow") && !value.is_empty() {
            rules.push(RobotsRule {
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
                crawl_delay = Some(delay);
            }
        }
    }

    RobotsTxtInfo {
        exists: true,
        allows_crawling: is_path_allowed(pathname, &rules),
        crawl_delay,
        disallowed_paths: rules
            .iter()
            .filter(|r| !r.allow)
            .map(|r| r.pattern.clone())
            .collect(),
        sitemaps,
    }
}

/// RFC 9309 matching: longest matching pattern wins, Allow wins ties;
/// no matching rule means allowed.
fn is_path_allowed(pathname: &str, rules: &[RobotsRule]) -> bool {
    let mut best_length: i64 = -1;
    let mut best_allow = true;

    for rule in rules {
        if !matches_robots_pattern(&rule.pattern, pathname) {
            continue;
        }
        let length = rule.pattern.len() as i64;
        let wins_tie = length == best_length && rule.allow && !best_allow;
        if length > best_length || wins_tie {
            best_length = length;
            best_allow = rule.allow;
        }
    }

    best_allow
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

            let actual = parse_robots_txt(body, path);

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
