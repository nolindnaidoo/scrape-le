//! URL validation, normalization, and extraction — the port of the
//! extension's `src/utils/url.ts`, quirks included: `fixtures/url.json`
//! deliberately pins the regex boundary artifacts and the blind
//! protocol prefixing, so "fixing" one here is a parity break, not an
//! improvement.

use std::sync::OnceLock;

use regex::Regex;
use url::Url;

/// The extension's `URL_REGEX`, verbatim — the fallback when native
/// parsing refuses.
const VALIDATE_PATTERN: &str = r"^https?://(www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&/=]*)$";

/// The same pattern unanchored, for finding a URL inside text.
const EXTRACT_PATTERN: &str = r"https?://(www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&/=]*)";

fn validate_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(VALIDATE_PATTERN).expect("validate pattern compiles"))
}

fn extract_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(EXTRACT_PATTERN).expect("extract pattern compiles"))
}

/// Validates an HTTP/HTTPS URL: native parsing first, the extension's
/// regex as the fallback.
pub(crate) fn validate_url(url: &str) -> bool {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return false;
    }
    match Url::parse(trimmed) {
        Ok(parsed) => parsed.scheme() == "http" || parsed.scheme() == "https",
        Err(_) => validate_regex().is_match(trimmed),
    }
}

/// Normalizes a URL by adding `https://` when no HTTP protocol is
/// present — blindly, as the extension does; `fixtures/url.json` pins
/// the `ftp://` quirk.
pub(crate) fn normalize_url(url: &str) -> String {
    let trimmed = url.trim();
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        return trimmed.to_string();
    }
    format!("https://{trimmed}")
}

/// Extracts the first valid URL from text, or normalizes the whole text
/// when it validates as a bare domain.
pub(crate) fn extract_url(text: &str) -> Option<String> {
    if text.is_empty() {
        return None;
    }
    if let Some(found) = extract_regex().find(text) {
        return Some(found.as_str().to_string());
    }
    let normalized = normalize_url(text);
    if validate_url(&normalized) {
        return Some(normalized);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURES: &str = include_str!("../../fixtures/url.json");

    fn cases(section: &str) -> Vec<serde_json::Value> {
        let all: serde_json::Value = serde_json::from_str(FIXTURES).expect("fixture JSON");
        all[section].as_array().expect("section array").clone()
    }

    #[test]
    fn validate_cases_reproduce() {
        for case in cases("validate") {
            let input = case["input"].as_str().expect("input");
            let expected = case["expected"].as_bool().expect("expected bool");
            assert_eq!(validate_url(input), expected, "validate {input:?}");
        }
    }

    #[test]
    fn normalize_cases_reproduce() {
        for case in cases("normalize") {
            let input = case["input"].as_str().expect("input");
            let expected = case["expected"].as_str().expect("expected string");
            assert_eq!(normalize_url(input), expected, "normalize {input:?}");
        }
    }

    #[test]
    fn extract_cases_reproduce() {
        for case in cases("extract") {
            let input = case["input"].as_str().expect("input");
            let expected = case["expected"].as_str();
            assert_eq!(extract_url(input).as_deref(), expected, "extract {input:?}");
        }
    }
}
