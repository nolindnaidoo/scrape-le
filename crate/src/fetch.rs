//! HTTP evidence gathering — the only module that touches the network
//! besides render.rs. Scope is the URL under check plus that origin's
//! `/robots.txt`, nothing else, ever.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use ureq::ResponseExt;

use crate::detect::check::Evidence;
use crate::detect::robots::RobotsDocument;

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

/// One robots.txt per origin, for the length of a run.
///
/// A batch is very often many paths on one site — that is the premise
/// the whole scheduler is built on — and each of those paths used to
/// re-fetch and re-parse the same document, compiling every one of its
/// rules again for an answer that could not have changed.
///
/// **The key is the origin: scheme, host and port.** That is exactly
/// what decides the URL fetched, `<origin>/robots.txt`, so it is exactly
/// what decides whether two URLs share an answer. `http://a.com` and
/// `https://a.com` are two documents and a site may serve different
/// rules on each, so they get two entries; `a.com:8443` is a third.
/// `batch::group_by_host` deliberately keys on the host *alone*, and the
/// two are not in tension: that key is politeness to a machine — never
/// two concurrent requests to it, whatever the scheme or port — while
/// this one is the identity of a document.
///
/// **Only what an origin served is kept, never a failure to get it.** A
/// 404, a 503, a refused connection, a timeout: all of them mean this
/// run has no document, so all of them are retried by the next URL on
/// that host exactly as they were before there was a cache. Holding
/// "nothing forbids you" from a blip would let one bad moment read as
/// permission for every remaining URL on the host, which is the one
/// direction this tool may not be wrong in. The cost is that a host with
/// no robots.txt is still asked once per URL, as it always was; the win
/// is confined to the case that carries a document to re-parse, which is
/// the case worth winning.
pub(crate) struct RobotsCache {
    origins: Mutex<HashMap<String, Arc<RobotsDocument>>>,
}

impl RobotsCache {
    pub(crate) fn new() -> Self {
        Self {
            origins: Mutex::new(HashMap::new()),
        }
    }

    /// The parsed robots.txt answering for `url`, fetched and parsed at
    /// most once per origin.
    fn document(&self, agent: &ureq::Agent, url: &str) -> Option<Arc<RobotsDocument>> {
        let origin = origin_of(url)?;
        if let Some(hit) = self
            .origins
            .lock()
            .ok()
            .and_then(|origins| origins.get(&origin).cloned())
        {
            return Some(hit);
        }
        // The lock is not held across the request. Holding it would put
        // every host in the batch behind whichever one is answering
        // slowest, which is precisely the concurrency the scheduler
        // exists to provide.
        let document = Arc::new(RobotsDocument::parse(&fetch_robots(agent, &origin)?));
        if let Ok(mut origins) = self.origins.lock() {
            origins.insert(origin, Arc::clone(&document));
        }
        Some(document)
    }
}

/// `<scheme>://<host>[:<port>]` — the origin whose `/robots.txt`
/// answers for this URL.
///
/// An opaque origin is refused rather than keyed: `url` serialises every
/// one of them as `"null"`, and two URLs that are not the same site must
/// never share an entry. Both surfaces validate http(s) before they get
/// here, so this is a guard on the key rather than a reachable path.
fn origin_of(url: &str) -> Option<String> {
    let origin = url::Url::parse(url).ok()?.origin();
    origin.is_tuple().then(|| origin.ascii_serialization())
}

pub(crate) fn fetch_evidence(url: &str, robots: &RobotsCache) -> Result<Evidence, FetchError> {
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

    let robots_document = robots.document(&agent, url);

    Ok(Evidence {
        url: url.to_string(),
        final_url,
        status: Some(status),
        headers,
        body_html,
        robots: robots_document,
        render: None,
        fetch_ms,
        total_ms: ms(started.elapsed()),
    })
}

/// `<origin>/robots.txt` on its own, for the render path — where the
/// page itself is loaded by the browser and never fetched over HTTP.
pub(crate) fn fetch_robots_only(url: &str, robots: &RobotsCache) -> Option<Arc<RobotsDocument>> {
    robots.document(&agent(), url)
}

/// `<origin>/robots.txt`, exactly one request. A non-2xx or
/// unreachable robots.txt is `None` — "no robots.txt" — matching the
/// extension's `response.ok` check.
fn fetch_robots(agent: &ureq::Agent, origin: &str) -> Option<String> {
    let mut response = agent.get(&format!("{origin}/robots.txt")).call().ok()?;
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
