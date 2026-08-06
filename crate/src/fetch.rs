//! HTTP evidence gathering — the only module that touches the network
//! besides render.rs. Scope is the URL under check plus that origin's
//! `/robots.txt`, nothing else, ever.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use ureq::ResponseExt;

use crate::detect::check::Evidence;

/// Response-body cap: a page bigger than this is truncated for
/// title/keyword evidence — detection needs the head of the document,
/// not a mirror of it.
const BODY_LIMIT: u64 = 2 * 1024 * 1024;

/// Transport failures split by what they say about the question. A DNS
/// failure or timeout means the question was malformed or unanswerable
/// (exit 2); anything else reachable-but-refused is a `blocked` verdict
/// (exit 1) — a real answer, and it is no.
pub(crate) enum FetchError {
    /// unparseable URL, DNS failure, timeout — exit 2
    Malformed(String),
    /// reached the network but the page could not be fetched — `blocked`
    Blocked(String),
}

pub(crate) fn fetch_evidence(url: &str) -> Result<Evidence, FetchError> {
    let started = Instant::now();
    let agent = agent();

    let fetch_start = Instant::now();
    let mut response = match agent.get(url).call() {
        Ok(response) => response,
        Err(error) => return Err(classify(&error)),
    };
    let fetch_ms = ms(fetch_start.elapsed());

    let status = response.status().as_u16();
    let final_url = response.get_uri().to_string();
    let headers = header_map(&response);
    let body_html = response
        .body_mut()
        .with_config()
        .limit(BODY_LIMIT)
        .read_to_string()
        .unwrap_or_default();

    let robots_body = fetch_robots(&agent, url);

    Ok(Evidence {
        url: url.to_string(),
        final_url,
        status: Some(status),
        headers,
        body_html,
        robots_body,
        render: None,
        fetch_ms,
        total_ms: ms(started.elapsed()),
    })
}

/// `<origin>/robots.txt`, 5s cap, exactly one request. A non-2xx or
/// unreachable robots.txt is `None` — "no robots.txt" — matching the
/// extension's `response.ok` check.
fn fetch_robots(agent: &ureq::Agent, url: &str) -> Option<String> {
    let parsed = url::Url::parse(url).ok()?;
    let robots_url = format!("{}/robots.txt", parsed.origin().ascii_serialization());
    let mut response = agent.get(&robots_url).call().ok()?;
    if !response.status().is_success() {
        return None;
    }
    response
        .body_mut()
        .with_config()
        .limit(BODY_LIMIT)
        .read_to_string()
        .ok()
}

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .http_status_as_error(false)
        .timeout_global(Some(Duration::from_secs(20)))
        .user_agent(concat!("scrape-le/", env!("CARGO_PKG_VERSION")))
        .build()
        .new_agent()
}

fn header_map(response: &ureq::http::Response<ureq::Body>) -> HashMap<String, String> {
    response
        .headers()
        .iter()
        .filter_map(|(name, value)| {
            let value = value.to_str().ok()?;
            Some((name.as_str().to_lowercase(), value.to_string()))
        })
        .collect()
}

fn classify(error: &ureq::Error) -> FetchError {
    match error {
        ureq::Error::Timeout(_) => FetchError::Malformed(format!("timed out: {error}")),
        ureq::Error::HostNotFound => FetchError::Malformed(format!("DNS failure: {error}")),
        ureq::Error::BadUri(_) => FetchError::Malformed(format!("unparseable URL: {error}")),
        // ureq surfaces resolver failures as opaque Io errors, so the
        // platform's getaddrinfo message is the only signal. Matched by
        // substring per platform: macOS/Linux say "lookup address",
        // Windows says "No such host". A DNS failure is a malformed
        // question (exit 2), not a blocked page.
        ureq::Error::Io(io)
            if io.to_string().contains("lookup address")
                || io.to_string().contains("No such host") =>
        {
            FetchError::Malformed(format!("DNS failure: {io}"))
        }
        other => FetchError::Blocked(format!("could not fetch the page: {other}")),
    }
}

fn ms(duration: Duration) -> u64 {
    u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
}
