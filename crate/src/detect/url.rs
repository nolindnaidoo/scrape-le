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

/// The URL a run will actually check, or `None` when the input names
/// none this tool can answer for.
///
/// **Composed from the three functions above rather than changing any of
/// them.** `../fixtures/url.json` pins their answers — including the
/// blind `https://` prefixing, which is one of the quirks it pins — and
/// this is the surfaces' guard in front of them, not a new port.
///
/// The prefixing is what made `ftp://example.com` read as a *host*
/// called `ftp`: it validated, and the run then died resolving it, so a
/// question about a scheme was refused as a failure of the network.
/// `javascript:` and `data:` carry no `://` and were already refused
/// truthfully; these now say the same thing.
///
/// RFC 3986 §3.1 also makes a scheme case-insensitive, and the corpus
/// pins `HTTPS://EXAMPLE.COM` valid — but `HTTP://host/x` did not start
/// with a prefix this recognised, so it was prefixed into a host called
/// `http` and refused as DNS too. The scheme is lower-cased and the rest
/// of the input kept verbatim, so nothing else about the URL moves.
pub(crate) fn target_url(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    let candidate = match scheme_of(trimmed) {
        Some(scheme) if is_http(scheme) => {
            format!("{}{}", scheme.to_lowercase(), &trimmed[scheme.len()..])
        }
        // A scheme this tool cannot answer for is a malformed question,
        // not a host nobody typed.
        Some(_) => return None,
        None => normalize_url(trimmed),
    };
    validate_url(&candidate).then_some(candidate)
}

/// The same, for a batch entry — which may carry a URL amid other text,
/// a log line or a CSV note column, where a command-line argument is
/// the URL itself.
///
/// What an entry is written as decides which half answers, because
/// neither half alone is right: `extract_url`'s regex spells `https?` in
/// lower case, so an upper-case scheme misses it and falls through to
/// the blind prefixing, while `target_url` would take
/// `(https://example.com/x)` whole — `(https` is a legal host to the URL
/// parser, so the prefixed string validates.
pub(crate) fn target_in_text(raw: &str) -> Option<String> {
    match scheme_of(raw.trim()) {
        // A scheme this tool cannot answer for is refused, not searched
        // for a better one inside itself.
        Some(scheme) if !is_http(scheme) => None,
        Some(_) => target_url(raw).or_else(|| extract_url(raw)),
        None => extract_url(raw),
    }
}

/// The scheme of an input, whether or not it carries `://`.
///
/// The authority marker is the easy half. The hard half is a scheme
/// written without one, because `mailto:x@y.com` and `localhost:3000`
/// have the same shape and only what follows the colon tells them apart.
/// Left unread, `mailto:x@y.com` was prefixed into
/// `https://mailto:x@y.com` — userinfo `mailto:x`, **host `y.com`** —
/// which validates, so the run fetched a host nobody named from a string
/// that is not an http(s) URL at all. `javascript:` and `data:` were
/// refused only because they happen not to parse.
///
/// So a colon names a scheme when what follows it cannot be a port, and
/// names a port otherwise. `example.com:` stays a host: the corpus pins
/// it, and an empty port is what a URL parser reads there too.
fn scheme_of(url: &str) -> Option<&str> {
    // `<scheme>://…`. Read here and nowhere else, so an entry that
    // carries an authority marker keeps taking the path it always took —
    // `warn: https://example.com/x` is text around a URL, not a scheme
    // called `warn`, and the colon rule below must never reach it.
    if let Some((scheme, _)) = url.split_once("://") {
        return valid_scheme(scheme);
    }
    let (scheme, rest) = url.split_once(':')?;
    let scheme = valid_scheme(scheme)?;
    (!is_port(rest)).then_some(scheme)
}

/// RFC 3986 §3.1: `ALPHA *( ALPHA / DIGIT / "+" / "-" / "." )`.
fn valid_scheme(scheme: &str) -> Option<&str> {
    let mut characters = scheme.chars();
    let first = characters.next()?;
    (first.is_ascii_alphabetic()
        && characters.all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.')))
    .then_some(scheme)
}

/// Whether what follows a colon is a port rather than the rest of a URI:
/// digits, up to whatever ends the authority. Empty counts, because
/// `example.com:` is a host with no port and the corpus pins it as one.
fn is_port(rest: &str) -> bool {
    let port = rest.split(['/', '?', '#']).next().unwrap_or(rest);
    port.is_empty() || port.bytes().all(|b| b.is_ascii_digit())
}

fn is_http(scheme: &str) -> bool {
    scheme.eq_ignore_ascii_case("http") || scheme.eq_ignore_ascii_case("https")
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

    /// **Regression.** The blind prefixing turned a scheme this tool
    /// cannot answer for into a *host*: `ftp://example.com` became
    /// `https://ftp://example.com`, which validates — host `ftp` — so
    /// the run died resolving a name nobody typed and reported a DNS
    /// failure for a question about the scheme. `javascript:` and
    /// `data:` carry no `://`, were never prefixed into a host, and
    /// always said what was actually wrong.
    #[test]
    fn a_scheme_this_tool_cannot_answer_for_is_refused_as_one() {
        for raw in [
            "ftp://example.com",
            "file:///etc/hosts",
            "javascript:alert(1)",
            "data:text/html,x",
            "ws://example.com/socket",
        ] {
            assert_eq!(target_url(raw), None, "{raw}");
            assert_eq!(target_in_text(raw), None, "{raw}");
        }
    }

    /// **Regression.** A scheme carrying no `://` was not a scheme to
    /// this, so the blind prefixing turned `mailto:x@y.com` into
    /// `https://mailto:x@y.com` — a URL whose *userinfo* is `mailto:x`
    /// and whose **host is `y.com`**. It validated, and the run then
    /// fetched a host nobody named, from a string that is not an
    /// http(s) URL at all.
    #[test]
    fn a_scheme_without_an_authority_marker_is_still_a_scheme() {
        for raw in [
            "mailto:x@y.com",
            "MAILTO:x@y.com",
            "tel:+15551234",
            "about:blank",
            "javascript:alert(1)",
            "data:text/html,x",
            "urn:isbn:0451450523",
        ] {
            assert_eq!(target_url(raw), None, "{raw}");
            assert_eq!(target_in_text(raw), None, "{raw}");
        }
    }

    /// And the colon that is a *port* still is one. This is the whole
    /// difficulty: `localhost:3000` and `mailto:x@y.com` have the same
    /// shape, and only what follows the colon tells them apart.
    #[test]
    fn a_port_is_not_mistaken_for_a_scheme() {
        for (raw, expected) in [
            ("localhost:3000", "https://localhost:3000"),
            ("localhost:3000/admin", "https://localhost:3000/admin"),
            ("example.com:8080/path", "https://example.com:8080/path"),
            ("127.0.0.1:8731/plain", "https://127.0.0.1:8731/plain"),
            ("example.com:", "https://example.com:"),
            ("example.com", "https://example.com"),
        ] {
            assert_eq!(target_url(raw).as_deref(), Some(expected), "{raw}");
        }
    }

    /// A batch entry may carry a URL amid text, and a colon in that text
    /// must not swallow it. `warn: https://example.com/x` still yields
    /// the URL — the refusal above is scoped to entries with no
    /// authority marker anywhere, which is the only shape the blind
    /// prefixing can turn into a host.
    #[test]
    fn a_colon_in_surrounding_text_does_not_swallow_the_url() {
        for raw in [
            "warn: https://example.com/x",
            "warn:https://example.com/x",
            "2026-08-16T00:00:00Z https://example.com/x",
            "Line 12: https://example.com/x",
        ] {
            assert_eq!(
                target_in_text(raw).as_deref(),
                Some("https://example.com/x"),
                "{raw}"
            );
        }
    }

    /// **Regression.** RFC 3986 §3.1: a scheme is case-insensitive, and
    /// the `validate` corpus above pins `HTTPS://EXAMPLE.COM` valid.
    /// `HTTP://host/path` matched neither prefix here, so it too was
    /// prefixed into a host — called `http` — and refused as DNS.
    #[test]
    fn an_upper_case_scheme_is_the_scheme_it_names() {
        assert_eq!(
            target_url("HTTP://127.0.0.1:8731/plain").as_deref(),
            Some("http://127.0.0.1:8731/plain")
        );
        assert_eq!(
            target_url("HTTPS://EXAMPLE.COM").as_deref(),
            Some("https://EXAMPLE.COM"),
            "only the scheme is folded; the rest of the URL is the caller's"
        );
        assert_eq!(
            target_url("HtTpS://example.com/a?b=C").as_deref(),
            Some("https://example.com/a?b=C")
        );
    }

    /// What the surfaces did before, unchanged: a bare domain is
    /// prefixed, a `host:port` with no authority marker is a host, and
    /// an unparseable argument is still refused.
    #[test]
    fn a_target_still_takes_what_it_always_took() {
        assert_eq!(
            target_url("example.com").as_deref(),
            Some("https://example.com")
        );
        assert_eq!(
            target_url("  https://example.com  ").as_deref(),
            Some("https://example.com")
        );
        assert_eq!(
            target_url("localhost:3000").as_deref(),
            Some("https://localhost:3000")
        );
        assert_eq!(target_url("not a url at all"), None);
        assert_eq!(target_url("https://"), None);
        assert_eq!(target_url(""), None);
    }

    /// A batch entry may carry its URL amid other text, and that is the
    /// only difference between the two.
    #[test]
    fn a_batch_entry_still_finds_a_url_amid_other_text() {
        for case in cases("extract") {
            let input = case["input"].as_str().expect("input");
            let expected = case["expected"].as_str();
            assert_eq!(
                target_in_text(input).as_deref(),
                expected,
                "batch entry {input:?}"
            );
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
