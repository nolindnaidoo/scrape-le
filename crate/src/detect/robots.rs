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
    /// Compiled once, when the group is parsed.
    ///
    /// Every pattern becomes a regex, and building one is orders of
    /// magnitude dearer than running it: a robots.txt with ten thousand
    /// `Disallow` lines compiled ten thousand regexes **per path
    /// checked**, and a batch is many paths against one host's rules.
    /// `None` is a pattern the engine refused, which matches nothing —
    /// the same answer the per-call version gave.
    matcher: Option<Regex>,
    /// The pattern's length **in UTF-16 code units**, which is what the
    /// extension's `pattern.length` counts.
    ///
    /// Longest-match-wins compares these, so the unit is part of the
    /// answer rather than an implementation detail: `/café` is six bytes
    /// and five units, so a rule beside it could win the tie here and
    /// lose it there — one server saying a path is disallowed and the
    /// other saying it is fine, for the same file.
    length: i64,
}

struct Group {
    agents: Vec<String>,
    rules: Vec<RobotsRule>,
    crawl_delay: Option<f64>,
}

/// One parsed robots.txt, with every rule's matcher already compiled.
///
/// **Parsing is per document; evaluating is per path.** Splitting them
/// is what lets a batch parse a host's file once and ask it fifty
/// questions: `fetch::RobotsCache` holds one of these per origin for
/// the length of a run. Nothing here is path- or agent-specific, so a
/// held document answers exactly what a fresh parse of the same bytes
/// would — asserted by a test, because that equivalence is the whole
/// licence to reuse it.
pub(crate) struct RobotsDocument {
    groups: Vec<Group>,
    sitemaps: Vec<String>,
}

impl RobotsDocument {
    pub(crate) fn parse(content: &str) -> Self {
        let (groups, sitemaps) = parse_groups(content);
        Self { groups, sitemaps }
    }

    /// Evaluates `pathname` against the rules that apply. `agent` is the
    /// caller's product token (`MyBot/1.0` → `mybot`); `None` evaluates
    /// the generic rules only, as the extension does.
    pub(crate) fn evaluate(&self, pathname: &str, agent: Option<&str>) -> RobotsTxtInfo {
        let token = agent.map(product_token);

        // An agent-specific group wins; with no match — or no agent —
        // the generic groups answer, which is RFC 9309 and also the
        // extension's only behaviour.
        let (selected, answering_agent) = match token.as_deref() {
            Some(token)
                if self
                    .groups
                    .iter()
                    .any(|g| g.agents.iter().any(|a| a == token)) =>
            {
                (select(&self.groups, token), token.to_string())
            }
            _ => (select(&self.groups, "*"), "*".to_string()),
        };

        let rules: Vec<&RobotsRule> = selected.iter().flat_map(|g| g.rules.iter()).collect();
        // **The last one wins**, across groups as well as within one.
        // The extension keeps assigning to a single `crawlDelay` as it
        // walks the file, so a document with two applicable groups
        // reports the second; taking the first here had the two servers
        // answer the same file differently.
        let crawl_delay = selected.iter().rev().find_map(|group| group.crawl_delay);
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
            sitemaps: self.sitemaps.clone(),
            agent: answering_agent,
            matched_rule: decision.matched,
        }
    }
}

/// Parses and evaluates in one call — for a caller holding a document it
/// asks exactly one question of, which is every caller that did not
/// fetch it: `analyze_robots_txt` is handed the content by the agent.
pub(crate) fn parse_robots_txt(
    content: &str,
    pathname: &str,
    agent: Option<&str>,
) -> RobotsTxtInfo {
    RobotsDocument::parse(content).evaluate(pathname, agent)
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
                matcher: compile_robots_pattern(value),
                length: i64::try_from(value.encode_utf16().count()).unwrap_or(i64::MAX),
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
        if !rule
            .matcher
            .as_ref()
            .is_some_and(|re| re.is_match(pathname))
        {
            continue;
        }
        let length = rule.length;
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

/// Builds the matcher for one robots.txt pattern: anchored at the start,
/// `*` matches any character sequence, a trailing `$` anchors the end.
/// Built the same way the extension builds it, so the two cannot
/// disagree about an edge.
///
/// A pattern the engine refuses — one past its size limit, say —
/// becomes `None` and matches nothing.
fn compile_robots_pattern(pattern: &str) -> Option<Regex> {
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
    Regex::new(&format!("^{escaped}{end}")).ok()
}

/// JS `Number.parseFloat` semantics: the longest numeric prefix parses,
/// so `10` and `10s` are both 10 and `not-a-number` is `None`.
///
/// Rust's float parser is the more generous of the two, and the
/// difference is a real answer: it reads `inf`, `infinity` and `nan` in
/// any casing, while `Number.parseFloat` accepts only `Infinity` spelled
/// exactly that way and never a NaN literal. `Crawl-delay: infinity` had
/// this server reporting a delay and the npm server reporting none — the
/// same tool, the same file, two answers.
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
        if !parsed.is_finite() && prefix.strip_prefix(['+', '-']).unwrap_or(prefix) != "Infinity" {
            // A shorter prefix may still be a number JavaScript reads.
            continue;
        }
        return Some(parsed);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    const CASES: &str = include_str!("../../fixtures/robots/cases.json");

    fn fixture_body(file: &str) -> &'static str {
        match file {
            "simple.txt" => include_str!("../../fixtures/robots/simple.txt"),
            "disallow-all.txt" => include_str!("../../fixtures/robots/disallow-all.txt"),
            "wildcards.txt" => include_str!("../../fixtures/robots/wildcards.txt"),
            "multi-group.txt" => include_str!("../../fixtures/robots/multi-group.txt"),
            "agent-specific.txt" => include_str!("../../fixtures/robots/agent-specific.txt"),
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

    /// The licence to hold a parsed document across a whole host's
    /// worth of URLs: one kept document must answer every path and
    /// every agent exactly as a fresh parse of the same bytes does.
    /// Were that ever untrue, a batch would answer differently from a
    /// single check of the same URL — the cache turning into a second
    /// implementation of the rules.
    #[test]
    fn a_kept_document_answers_what_a_fresh_parse_answers() {
        let cases: serde_json::Value = serde_json::from_str(CASES).expect("fixture JSON");
        let mut checked = 0;
        for file in [
            "simple.txt",
            "disallow-all.txt",
            "wildcards.txt",
            "multi-group.txt",
            "agent-specific.txt",
        ] {
            let body = fixture_body(file);
            let kept = RobotsDocument::parse(body);
            // Every path any case names, against every agent any case
            // names — the paths and agents this corpus actually cares
            // about, rather than ones invented here.
            for case in cases.as_array().expect("array of cases") {
                let path = case["path"].as_str().expect("path");
                for agent in [None, Some("googlebot"), Some("PickyBot/1.0"), Some("mybot")] {
                    assert_eq!(
                        kept.evaluate(path, agent),
                        parse_robots_txt(body, path, agent),
                        "{file} {path:?} as {agent:?}"
                    );
                    checked += 1;
                }
            }
        }
        assert!(checked > 0, "expected paths to check");
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

    /// The pattern matcher, reached the way `decide_path` reaches it.
    fn matches_robots_pattern(pattern: &str, pathname: &str) -> bool {
        compile_robots_pattern(pattern).is_some_and(|re| re.is_match(pathname))
    }

    /// **Regression.** Longest-match-wins compares pattern lengths, and
    /// the extension counts UTF-16 code units while `str::len` counts
    /// bytes. `/café` is five units and six, so the rule beside it won
    /// the tie on one server and lost it on the other — one saying the
    /// path is disallowed and the other saying it is fine.
    #[test]
    fn a_pattern_is_measured_in_the_units_the_extension_measures() {
        let body = "User-agent: *\nDisallow: /caf\u{e9}\nAllow: /ca*e\n";
        let info = parse_robots_txt(body, "/caf\u{e9}/page", None);
        assert!(
            info.allows_crawling,
            "the two patterns are the same length in UTF-16, and Allow wins a tie"
        );
    }

    /// **Regression.** The extension assigns to one `crawlDelay` as it
    /// walks the file, so the last applicable group wins. Keeping the
    /// first had the two servers report different delays for the same
    /// document.
    #[test]
    fn the_last_crawl_delay_wins_across_groups() {
        let body = "User-agent: *\nCrawl-delay: 5\nUser-agent: *\nCrawl-delay: 10\n";
        assert_eq!(parse_robots_txt(body, "/", None).crawl_delay, Some(10.0));
    }

    /// **Regression.** Rust's float parser reads `inf`, `infinity` and
    /// `nan` in any casing; `Number.parseFloat` reads only `Infinity`,
    /// spelled exactly that way.
    #[test]
    fn a_crawl_delay_parses_the_way_javascript_parses_it() {
        let delay = |value: &str| {
            parse_robots_txt(&format!("User-agent: *\nCrawl-delay: {value}\n"), "/", None)
                .crawl_delay
        };
        assert_eq!(delay("10"), Some(10.0));
        assert_eq!(delay("10s"), Some(10.0));
        assert_eq!(delay("1e3"), Some(1000.0));
        assert_eq!(delay("0x10"), Some(0.0));
        assert_eq!(delay("+5"), Some(5.0));
        assert_eq!(delay(".5"), Some(0.5));
        assert_eq!(delay("infinity"), None, "JavaScript reads no such number");
        assert_eq!(delay("inf"), None);
        assert_eq!(delay("nan"), None);
        assert_eq!(delay("abc"), None);
        assert_eq!(delay("-1"), None, "a negative delay is not a delay");
        assert!(delay("Infinity").is_some_and(f64::is_infinite));
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
