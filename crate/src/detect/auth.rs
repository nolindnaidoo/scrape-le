//! Authentication detection — the evidence-level port of the
//! extension's `src/detectors/authentication.ts`. The status and
//! URL-segment checks run on any fetch; the login-form and keyword
//! checks need the rendered page and arrive with render.rs, which is
//! why the check reports `partial` without a DOM.

use url::Url;

#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct AuthInfo {
    pub(crate) required: bool,
    pub(crate) indicators: Vec<String>,
}

/// The extension requires one strong indicator (401/403 status or a
/// login form) or two weak ones. Without a DOM the strong signal is
/// status alone; a lone URL segment stays below the bar, exactly as it
/// does in the extension.
pub(crate) fn detect_authentication(status: Option<u16>, final_url: &str) -> AuthInfo {
    let mut indicators: Vec<String> = Vec::new();

    let has_auth_status = check_auth_status(status, &mut indicators);
    let has_url_indicator = check_url_segments(final_url, &mut indicators);

    let required = has_auth_status || (indicators.len() >= 2 && has_url_indicator);
    if !required {
        return AuthInfo {
            required: false,
            indicators,
        };
    }
    AuthInfo {
        required: true,
        indicators,
    }
}

fn check_auth_status(status: Option<u16>, indicators: &mut Vec<String>) -> bool {
    if status == Some(401) {
        indicators.push("HTTP 401 Unauthorized".to_string());
        return true;
    }
    if status == Some(403) {
        indicators.push("HTTP 403 Forbidden".to_string());
        return true;
    }
    false
}

/// Matches whole path segments, not substrings — `/author/jane` must
/// not match `auth`.
fn check_url_segments(final_url: &str, indicators: &mut Vec<String>) -> bool {
    const AUTH_SEGMENTS: [&str; 5] = ["login", "signin", "sign-in", "auth", "authenticate"];
    let Ok(parsed) = Url::parse(final_url) else {
        return false;
    };
    let pathname = parsed.path().to_lowercase();
    for segment in pathname.split('/').filter(|s| !s.is_empty()) {
        if AUTH_SEGMENTS.contains(&segment) {
            indicators.push(format!("URL contains auth path segment: /{segment}"));
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_401_requires_auth() {
        let info = detect_authentication(Some(401), "https://example.com/api");
        assert!(info.required);
        assert_eq!(info.indicators, ["HTTP 401 Unauthorized"]);
    }

    #[test]
    fn status_403_requires_auth() {
        let info = detect_authentication(Some(403), "https://example.com/");
        assert!(info.required);
        assert_eq!(info.indicators, ["HTTP 403 Forbidden"]);
    }

    #[test]
    fn lone_url_segment_stays_below_the_bar() {
        let info = detect_authentication(Some(200), "https://example.com/login");
        assert!(!info.required);
        assert_eq!(info.indicators, ["URL contains auth path segment: /login"]);
    }

    #[test]
    fn author_path_does_not_match_auth() {
        let info = detect_authentication(Some(200), "https://example.com/author/jane");
        assert!(!info.required);
        assert!(info.indicators.is_empty());
    }

    #[test]
    fn status_plus_segment_reports_both_indicators() {
        let info = detect_authentication(Some(401), "https://example.com/signin");
        assert!(info.required);
        assert_eq!(info.indicators.len(), 2);
    }
}
