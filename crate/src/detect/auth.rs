//! Authentication detection — the port of the extension's
//! `src/detectors/authentication.ts`. Status and URL-segment checks run
//! on any fetch; login-form and keyword evidence arrives from
//! `render.rs` when the page rendered. Indicator strings and the
//! required-bar combinator are ported verbatim: one strong signal
//! (401/403 or a password field) or two weak ones.

use url::Url;

use super::check::AuthPageEvidence;

#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct AuthInfo {
    pub(crate) required: bool,
    pub(crate) auth_type: Option<&'static str>,
    pub(crate) login_url: Option<String>,
    pub(crate) indicators: Vec<String>,
}

pub(crate) fn detect_authentication(
    status: Option<u16>,
    final_url: &str,
    page: Option<&AuthPageEvidence>,
) -> AuthInfo {
    let mut indicators: Vec<String> = Vec::new();

    let has_auth_status = check_auth_status(status, &mut indicators);
    let (form_detected, auth_type, login_url) = check_login_form(page, &mut indicators);
    let has_keywords = check_keywords(page, &mut indicators);
    let has_url_indicator = check_url_segments(final_url, &mut indicators);

    let required = has_auth_status
        || form_detected
        || (indicators.len() >= 2 && (has_keywords || has_url_indicator));
    if !required {
        return AuthInfo {
            required: false,
            ..AuthInfo::default()
        };
    }
    AuthInfo {
        required: true,
        auth_type,
        login_url,
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

/// A password field inside a form is the strong signal; a bare password
/// field still detects. The detail string names username + password
/// whenever a form is present, as the extension's does.
fn check_login_form(
    page: Option<&AuthPageEvidence>,
    indicators: &mut Vec<String>,
) -> (bool, Option<&'static str>, Option<String>) {
    let Some(page) = page else {
        return (false, None, None);
    };
    if !page.has_password_input {
        return (false, None, None);
    }
    if page.has_form {
        indicators.push("Login form detected (username + password fields)".to_string());
        return (true, Some("form"), page.form_action.clone());
    }
    indicators.push("Password input detected".to_string());
    (true, Some("form"), None)
}

fn check_keywords(page: Option<&AuthPageEvidence>, indicators: &mut Vec<String>) -> bool {
    let Some(keyword) = page.and_then(|p| p.keyword.as_deref()) else {
        return false;
    };
    indicators.push(format!("Authentication keyword: \"{keyword}\""));
    true
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

    fn page(
        password: bool,
        form: bool,
        action: Option<&str>,
        keyword: Option<&str>,
    ) -> AuthPageEvidence {
        AuthPageEvidence {
            has_password_input: password,
            has_form: form,
            has_username_input: form,
            form_action: action.map(str::to_string),
            keyword: keyword.map(str::to_string),
        }
    }

    #[test]
    fn status_401_requires_auth() {
        let info = detect_authentication(Some(401), "https://example.com/api", None);
        assert!(info.required);
        assert_eq!(info.indicators, ["HTTP 401 Unauthorized"]);
    }

    #[test]
    fn login_form_is_a_strong_signal() {
        let evidence = page(true, true, Some("https://example.com/session"), None);
        let info = detect_authentication(Some(200), "https://example.com/", Some(&evidence));
        assert!(info.required);
        assert_eq!(info.auth_type, Some("form"));
        assert_eq!(
            info.login_url.as_deref(),
            Some("https://example.com/session")
        );
        assert_eq!(
            info.indicators,
            ["Login form detected (username + password fields)"]
        );
    }

    #[test]
    fn bare_password_input_still_detects() {
        let evidence = page(true, false, None, None);
        let info = detect_authentication(Some(200), "https://example.com/", Some(&evidence));
        assert!(info.required);
        assert_eq!(info.indicators, ["Password input detected"]);
        assert_eq!(info.login_url, None);
    }

    #[test]
    fn lone_keyword_stays_below_the_bar() {
        let evidence = page(false, false, None, Some("sign in"));
        let info = detect_authentication(Some(200), "https://example.com/", Some(&evidence));
        assert!(!info.required);
        // not-required drops indicators, as the extension's
        // createDefaultAuthInfo does
        assert!(info.indicators.is_empty());
    }

    #[test]
    fn keyword_plus_url_segment_clears_the_bar() {
        let evidence = page(false, false, None, Some("members only"));
        let info = detect_authentication(Some(200), "https://example.com/login", Some(&evidence));
        assert!(info.required);
        assert_eq!(info.indicators.len(), 2);
    }

    #[test]
    fn lone_url_segment_stays_below_the_bar() {
        let info = detect_authentication(Some(200), "https://example.com/login", None);
        assert!(!info.required);
        assert!(info.indicators.is_empty());
    }

    #[test]
    fn author_path_does_not_match_auth() {
        let info = detect_authentication(Some(200), "https://example.com/author/jane", None);
        assert!(!info.required);
        assert!(info.indicators.is_empty());
    }
}
