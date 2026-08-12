//! Browser evidence gathering — the spike graduated. Drives a Chromium
//! the user already has over sync CDP and returns what only a rendered
//! page can show: the document's own status and response headers,
//! script sources, DOM selectors, window globals, login forms, page
//! text, console errors, the post-JS title and URL, and a full-page
//! screenshot.
//!
//! **One page load.** The document response is captured over CDP, so a
//! rendered check hits the site exactly once — asking whether it is
//! acceptable to scrape a site should not cost that site two requests.
//! `robots.txt` is the one additional fetch, as the extension does it.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use headless_chrome::browser::default_executable;
use headless_chrome::protocol::cdp::Emulation::{
    ClearDeviceMetricsOverride, SetDeviceMetricsOverride,
};
use headless_chrome::protocol::cdp::Network::ResourceType;
use headless_chrome::protocol::cdp::Page::CaptureScreenshotFormatOption;
use headless_chrome::protocol::cdp::types::Event;
use headless_chrome::{Browser, LaunchOptions};

use crate::detect::check::{AuthPageEvidence, ProbeResult, RenderEvidence};
use crate::detect::signatures::signatures;

/// Chrome refuses a capture larger than its maximum texture dimension.
/// A taller page is captured to this height rather than failing; the
/// screenshot is documentation, never evidence a finding rests on.
const MAX_CAPTURE_PX: f64 = 16_384.0;

/// The family `default_executable()` does not know: Brave and Edge.
/// The macOS paths are verified on real hardware; the Linux and Windows
/// candidates follow each browser's documented install locations and
/// get verified when CI or a real machine exercises them.
const CANDIDATES: &[&str] = &[
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/brave-browser",
    "/usr/bin/microsoft-edge",
    "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];

/// `CHROME` env override first, then the crate's discovery (Chrome and
/// Chromium), then the candidate list above.
pub(crate) fn find_browser() -> Result<PathBuf, String> {
    if let Ok(path) = std::env::var("CHROME") {
        let path = PathBuf::from(path);
        if path.exists() {
            return Ok(path);
        }
        return Err(format!(
            "CHROME points at {}, which does not exist",
            path.display()
        ));
    }
    if let Ok(path) = default_executable() {
        return Ok(path);
    }
    for candidate in CANDIDATES {
        let path = PathBuf::from(candidate);
        if path.exists() {
            return Ok(path);
        }
    }
    Err(
        "no Chromium-family browser found (Chrome, Chromium, Brave, Edge) — \
         install one or set CHROME to its executable"
            .to_string(),
    )
}

pub(crate) fn render(url: &str, browser_path: PathBuf) -> Result<RenderEvidence, String> {
    let started = Instant::now();
    let browser = Browser::new(
        LaunchOptions::default_builder()
            .path(Some(browser_path))
            .headless(true)
            .window_size(Some((1280, 800)))
            .idle_browser_timeout(Duration::from_secs(60))
            .build()
            .map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    let tab = browser.new_tab().map_err(|e| e.to_string())?;

    // The document's own response, captured before navigating so the
    // page is loaded once rather than once per evidence source. A
    // redirect chain emits one Document response per hop; the last one
    // is the page that actually answered.
    let document: Arc<Mutex<Option<DocumentResponse>>> = Arc::new(Mutex::new(None));
    let sink = Arc::clone(&document);
    tab.register_response_handling(
        "document",
        Box::new(move |params, _fetch_body| {
            if params.Type != ResourceType::Document {
                return;
            }
            let Ok(mut slot) = sink.lock() else {
                return;
            };
            *slot = Some(DocumentResponse {
                url: params.response.url.clone(),
                status: u16::try_from(params.response.status).unwrap_or(0),
                headers: header_map(&params.response.headers),
            });
        }),
    )
    .map_err(|e| e.to_string())?;

    // Console errors and warnings plus uncaught exceptions, as the
    // extension collects them.
    let console: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&console);
    tab.enable_log().map_err(|e| e.to_string())?;
    tab.add_event_listener(Arc::new(move |event: &Event| {
        if let Event::LogEntryAdded(entry) = event {
            let level = format!("{:?}", entry.params.entry.level).to_lowercase();
            if (level == "error" || level == "warning")
                && let Ok(mut messages) = sink.lock()
            {
                messages.push(entry.params.entry.text.clone());
            }
        }
    }))
    .map_err(|e| e.to_string())?;

    tab.navigate_to(url).map_err(|e| e.to_string())?;
    tab.wait_until_navigated().map_err(|e| e.to_string())?;
    settle(&tab);

    let probes = run_page_probe(&tab)?;
    let auth = run_auth_probe(&tab)?;
    let title = tab.get_title().ok().filter(|t| !t.is_empty());
    let final_url = Some(tab.get_url());
    let body_html = tab.get_content().unwrap_or_default();
    let screenshot = capture_screenshot(&tab, url);

    let console_errors = console.lock().map(|m| m.clone()).unwrap_or_default();
    let document = document.lock().ok().and_then(|slot| slot.clone());

    // The document response's own URL is the endpoint CDP saw; the
    // tab's URL can differ after a client-side route change, so keep
    // the tab's as final_url and let the document's inform status.
    let final_url = document
        .as_ref()
        .map(|d| d.url.clone())
        .filter(|url| !url.is_empty())
        .or(final_url);

    Ok(RenderEvidence {
        final_url,
        title,
        body_html,
        status: document.as_ref().map(|d| d.status),
        headers: document.map(|d| d.headers),
        probes,
        auth,
        console_errors,
        screenshot,
        render_ms: ms(started.elapsed()),
    })
}

/// The document response as CDP delivered it.
#[derive(Clone)]
struct DocumentResponse {
    url: String,
    status: u16,
    headers: HashMap<String, String>,
}

/// CDP delivers headers as a JSON object with the server's own casing;
/// the detectors expect lowercase keys, as a browser delivers them.
fn header_map(
    headers: &headless_chrome::protocol::cdp::Network::Headers,
) -> HashMap<String, String> {
    let Some(object) = headers.0.as_ref().and_then(serde_json::Value::as_object) else {
        return HashMap::new();
    };
    object
        .iter()
        .filter_map(|(name, value)| Some((name.to_lowercase(), value.as_str()?.to_string())))
        .collect()
}

/// The extension waits for `load` then gives SPAs a best-effort settle
/// (≤5s network-idle). Sync CDP has no network-idle signal, so this
/// polls `document.readyState` to `complete` with the same 5s cap and
/// grants a short grace for late-rendering widgets.
fn settle(tab: &headless_chrome::Tab) {
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        let ready = tab
            .evaluate("document.readyState", false)
            .ok()
            .and_then(|r| r.value)
            .and_then(|v| v.as_str().map(str::to_string));
        if ready.as_deref() == Some("complete") {
            break;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    std::thread::sleep(Duration::from_millis(500));
}

/// One evaluate round-trip for all vendors, exactly the extension's
/// What the page is asked about, built from the shared corpus rather
/// than restated here — so a vendor added to `signatures/` is a vendor
/// the page is actually probed for.
///
/// Split out from the probe so the coverage matrix can assert every
/// declared signal reaches the page without launching a browser. A
/// signature in the corpus that the probe never carries is a vendor the
/// crate claims to detect and never looks for.
fn probe_payload() -> Vec<serde_json::Value> {
    signatures()
        .iter()
        .map(|signature| {
            serde_json::json!({
                "key": signature.key,
                "scriptSubstrings": signature.script_substrings,
                "selectors": signature.selectors,
                "globals": signature.globals,
            })
        })
        .collect()
}

/// `pageProbeScan`: script src substrings, DOM selectors, window
/// globals, per signature.
fn run_page_probe(
    tab: &headless_chrome::Tab,
) -> Result<std::collections::HashMap<String, ProbeResult>, String> {
    let probes = probe_payload();
    let script = format!(
        r"(() => {{
  const probes = {};
  const scripts = Array.from(document.getElementsByTagName('script')).map(s => s.src);
  const result = {{}};
  for (const probe of probes) {{
    result[probe.key] = {{
      script: probe.scriptSubstrings.some(sub => scripts.some(src => src.includes(sub))),
      selector: probe.selectors.some(sel => {{ try {{ return document.querySelector(sel) !== null; }} catch {{ return false; }} }}),
      global: probe.globals.some(name => name in window),
    }};
  }}
  return JSON.stringify(result);
}})()",
        serde_json::to_string(&probes).map_err(|e| e.to_string())?
    );
    let raw = evaluate_string(tab, &script)?;
    let parsed: std::collections::HashMap<String, serde_json::Value> =
        serde_json::from_str(&raw).map_err(|e| format!("probe result: {e}"))?;
    Ok(parsed
        .into_iter()
        .map(|(key, v)| {
            (
                key,
                ProbeResult {
                    script: v["script"].as_bool().unwrap_or(false),
                    selector: v["selector"].as_bool().unwrap_or(false),
                    global: v["global"].as_bool().unwrap_or(false),
                },
            )
        })
        .collect())
}

/// The extension's login-form and keyword evaluates, combined into one
/// round-trip. Selectors, keyword list, and semantics are ported
/// verbatim from `src/detectors/authentication.ts`.
fn run_auth_probe(tab: &headless_chrome::Tab) -> Result<AuthPageEvidence, String> {
    const SCRIPT: &str = r#"(() => {
  const form = (() => {
    const passwordInputs = document.querySelectorAll('input[type="password"]');
    if (passwordInputs.length === 0) return { hasPasswordInput: false, hasForm: false, hasUsernameInput: false, action: null };
    const passwordInput = passwordInputs[0];
    const f = passwordInput ? passwordInput.closest('form') : null;
    if (f) {
      const hasUsernameInput =
        f.querySelector('input[type="text"]') !== null ||
        f.querySelector('input[type="email"]') !== null ||
        f.querySelector('input[name*="user"]') !== null ||
        f.querySelector('input[name*="email"]') !== null;
      return { hasPasswordInput: true, hasForm: true, hasUsernameInput, action: f.action || null };
    }
    return { hasPasswordInput: true, hasForm: false, hasUsernameInput: false, action: null };
  })();
  const text = document.body ? document.body.innerText.toLowerCase() : '';
  const keywords = ['sign in','log in','login required','please log in','authentication required','access denied','unauthorized access','members only','please sign in'];
  let keyword = null;
  for (const k of keywords) { if (text.includes(k)) { keyword = k; break; } }
  return JSON.stringify({ form, keyword });
})()"#;
    let raw = evaluate_string(tab, SCRIPT)?;
    let parsed: serde_json::Value =
        serde_json::from_str(&raw).map_err(|e| format!("auth probe result: {e}"))?;
    Ok(AuthPageEvidence {
        has_password_input: parsed["form"]["hasPasswordInput"]
            .as_bool()
            .unwrap_or(false),
        has_form: parsed["form"]["hasForm"].as_bool().unwrap_or(false),
        has_username_input: parsed["form"]["hasUsernameInput"]
            .as_bool()
            .unwrap_or(false),
        form_action: parsed["form"]["action"].as_str().map(str::to_string),
        keyword: parsed["keyword"].as_str().map(str::to_string),
    })
}

fn evaluate_string(tab: &headless_chrome::Tab, script: &str) -> Result<String, String> {
    let result = tab.evaluate(script, false).map_err(|e| e.to_string())?;
    result
        .value
        .and_then(|v| v.as_str().map(str::to_string))
        .ok_or_else(|| "evaluate returned no string".to_string())
}

/// Full-page screenshot into the working directory, named like the
/// extension's `convertUrlToFilename`: hostname with dots dashed plus
/// the date — which means a same-day re-check overwrites, exactly as
/// the extension documents.
///
/// Full-page is done by emulating a viewport the size of the document
/// and capturing that, then clearing the override. `capture_screenshot`
/// hard-codes `capture_beyond_viewport` off, and the alternative —
/// calling the CDP method directly — would mean decoding base64 here
/// and carrying a dependency for one image.
fn capture_screenshot(tab: &headless_chrome::Tab, url: &str) -> Option<String> {
    let filename = screenshot_name(url, civil_date_today())?;

    let resized = resize_to_document(tab);
    let png = tab
        .capture_screenshot(CaptureScreenshotFormatOption::Png, None, None, true)
        .ok();
    if resized {
        let _ = tab.call_method(ClearDeviceMetricsOverride(None));
    }

    std::fs::write(&filename, png?).ok()?;
    Some(format!("./{filename}"))
}

/// The only path the report ever carries, built without `PathBuf` and
/// with a literal `/` — so it reads the same on Windows as everywhere
/// else. A sibling crate shipped a release whose report used the
/// platform separator, and the same repository then described itself two
/// ways depending on the machine that ran the check.
///
/// Split out from the capture so the shape can be asserted without a
/// browser; the capture itself belongs to `scenarios`.
fn screenshot_name(url: &str, date: (i64, u8, u8)) -> Option<String> {
    let hostname = url::Url::parse(url).ok()?.host_str()?.replace('.', "-");
    let (year, month, day) = date;
    Some(format!(
        "scrape-le-{hostname}-{year:04}-{month:02}-{day:02}.png"
    ))
}

/// Emulates a viewport as tall as the document, so the capture covers
/// the whole page. Chrome refuses dimensions past its maximum texture
/// size, so a very long page is captured to `MAX_CAPTURE_PX` — the
/// screenshot is documentation, never evidence a finding rests on.
fn resize_to_document(tab: &headless_chrome::Tab) -> bool {
    let Ok(raw) = evaluate_string(
        tab,
        "JSON.stringify({w:Math.max(document.documentElement.scrollWidth,document.body?document.body.scrollWidth:0),\
         h:Math.max(document.documentElement.scrollHeight,document.body?document.body.scrollHeight:0)})",
    ) else {
        return false;
    };
    let Ok(size) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return false;
    };
    let (Some(width), Some(height)) = (size["w"].as_f64(), size["h"].as_f64()) else {
        return false;
    };
    if width <= 0.0 || height <= 0.0 {
        return false;
    }
    let width = width.min(MAX_CAPTURE_PX) as u32;
    let height = height.min(MAX_CAPTURE_PX) as u32;
    tab.call_method(SetDeviceMetricsOverride {
        width,
        height,
        device_scale_factor: 1.0,
        mobile: false,
        scale: None,
        screen_width: None,
        screen_height: None,
        position_x: None,
        position_y: None,
        dont_set_visible_size: None,
        screen_orientation: None,
        viewport: None,
        display_feature: None,
        device_posture: None,
    })
    .is_ok()
}

/// Civil date from the system clock, Howard Hinnant's days-from-epoch
/// algorithm — a date dependency would be a heavy price for one
/// filename.
fn civil_date_today() -> (i64, u8, u8) {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());
    let days = i64::try_from(secs / 86_400).unwrap_or(0);
    civil_from_days(days)
}

fn civil_from_days(days: i64) -> (i64, u8, u8) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { year + 1 } else { year };
    (
        year,
        u8::try_from(month).unwrap_or(1),
        u8::try_from(day).unwrap_or(1),
    )
}

fn ms(duration: Duration) -> u64 {
    u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn civil_from_days_matches_known_dates() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(19_723), (2024, 1, 1));
        assert_eq!(civil_from_days(20_671), (2026, 8, 6));
    }

    /// The one path the report carries, on every platform. envsync-le
    /// shipped a release whose report used `\` on Windows; this is built
    /// from a format string rather than a `PathBuf` so it cannot.
    #[test]
    fn the_screenshot_name_is_the_same_on_every_platform() {
        let name = screenshot_name("https://sub.example.com/a/b?c=1", (2026, 8, 6))
            .expect("a name for a URL with a host");
        assert_eq!(name, "scrape-le-sub-example-com-2026-08-06.png");
        assert!(!name.contains('\\'), "{name}");
        assert!(!name.contains(std::path::MAIN_SEPARATOR), "{name}");
    }

    #[test]
    fn a_url_without_a_host_gets_no_screenshot_name() {
        assert_eq!(screenshot_name("not a url", (2026, 8, 6)), None);
    }

    /// **Coverage matrix, the browser half.** Every signal the corpus
    /// declares must reach the page. A vendor whose selectors never
    /// leave the crate is a vendor it claims to detect and never looks
    /// for — the "opens 21 of 88" failure, in a place nothing else
    /// would notice.
    #[test]
    fn coverage_matrix_every_declared_signal_reaches_the_page() {
        let payload = probe_payload();
        assert_eq!(
            payload.len(),
            signatures().len(),
            "a vendor is missing from the probe"
        );
        let rendered = serde_json::to_string(&payload).expect("the payload serializes");

        let mut signals = 0;
        for signature in signatures() {
            let probe = payload
                .iter()
                .find(|probe| probe["key"] == signature.key.as_str())
                .unwrap_or_else(|| panic!("{} is not probed for", signature.key));
            for (field, declared) in [
                ("scriptSubstrings", &signature.script_substrings),
                ("selectors", &signature.selectors),
                ("globals", &signature.globals),
            ] {
                for signal in declared {
                    assert!(
                        probe[field]
                            .as_array()
                            .expect("a list")
                            .iter()
                            .any(|carried| carried == signal),
                        "{}: {signal} is declared and never probed for",
                        signature.key
                    );
                    assert!(
                        rendered.contains(signal.as_str()),
                        "{}: {signal} never reaches the page",
                        signature.key
                    );
                    signals += 1;
                }
            }
        }
        // Not vacuous: an empty corpus would satisfy every loop above.
        assert!(
            signals >= 5,
            "the corpus declares {signals} page signals, which is too few to be a matrix"
        );
        eprintln!(
            "coverage-matrix: {signals} page signals across {} vendors",
            payload.len()
        );
    }
}
