//! Rate-limit detection from response headers — the port of the
//! extension's `src/detectors/ratelimit.ts`. Empty header values are
//! absent, exactly as JS falsiness treats them.

use std::collections::HashMap;

#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct RateLimitInfo {
    pub(crate) detected: bool,
    pub(crate) limit: Option<String>,
    pub(crate) remaining: Option<String>,
    pub(crate) reset: Option<String>,
    pub(crate) retry_after: Option<String>,
}

pub(crate) fn detect_rate_limit(
    headers: &HashMap<String, String>,
    status: Option<u16>,
) -> RateLimitInfo {
    let first = |a: &str, b: &str| -> Option<String> {
        non_empty(headers.get(a)).or_else(|| non_empty(headers.get(b)))
    };
    let limit = first("x-ratelimit-limit", "ratelimit-limit");
    let remaining = first("x-ratelimit-remaining", "ratelimit-remaining");
    let reset = first("x-ratelimit-reset", "ratelimit-reset");
    let retry_after = non_empty(headers.get("retry-after"));

    // HTTP 429 is rate limiting even without advertised headers
    let rate_limited = status == Some(429);
    let has_headers =
        limit.is_some() || remaining.is_some() || reset.is_some() || retry_after.is_some();
    if !has_headers && !rate_limited {
        return RateLimitInfo::default();
    }

    RateLimitInfo {
        detected: true,
        limit,
        remaining,
        reset,
        retry_after,
    }
}

fn non_empty(value: Option<&String>) -> Option<String> {
    value.filter(|v| !v.is_empty()).cloned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn headers(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
            .collect()
    }

    #[test]
    fn x_prefixed_headers_detect() {
        let info = detect_rate_limit(
            &headers(&[
                ("x-ratelimit-limit", "100"),
                ("x-ratelimit-remaining", "95"),
                ("x-ratelimit-reset", "1234567890"),
            ]),
            Some(200),
        );
        assert!(info.detected);
        assert_eq!(info.limit.as_deref(), Some("100"));
        assert_eq!(info.remaining.as_deref(), Some("95"));
    }

    #[test]
    fn unprefixed_headers_detect() {
        let info = detect_rate_limit(
            &headers(&[("ratelimit-limit", "50"), ("ratelimit-remaining", "10")]),
            Some(200),
        );
        assert!(info.detected);
        assert_eq!(info.limit.as_deref(), Some("50"));
    }

    #[test]
    fn retry_after_alone_detects() {
        let info = detect_rate_limit(&headers(&[("retry-after", "120")]), Some(200));
        assert!(info.detected);
        assert_eq!(info.retry_after.as_deref(), Some("120"));
    }

    #[test]
    fn status_429_detects_without_headers() {
        let info = detect_rate_limit(&headers(&[]), Some(429));
        assert!(info.detected);
        assert_eq!(info.limit, None);
    }

    #[test]
    fn empty_strings_are_absent_like_js_falsiness() {
        let info = detect_rate_limit(
            &headers(&[("x-ratelimit-limit", ""), ("retry-after", "")]),
            Some(200),
        );
        assert!(!info.detected);
    }

    #[test]
    fn clean_headers_do_not_detect() {
        let info = detect_rate_limit(&headers(&[("content-type", "text/html")]), Some(200));
        assert!(!info.detected);
    }
}
