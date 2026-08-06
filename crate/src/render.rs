//! Browser evidence gathering — the spike graduated. Drives a Chromium
//! the user already has over sync CDP and returns what only a rendered
//! page can show: script sources, DOM selectors, window globals, login
//! forms, page text, console errors, the post-JS title and URL, and a
//! screenshot.
//!
//! Two honest gaps against the extension, both deliberate for now:
//! the page is fetched twice (ureq for headers, the browser for the
//! DOM — response-header capture over CDP is the fix), and the
//! screenshot covers the viewport, not the full page
//! (`headless_chrome` does not expose capture-beyond-viewport).

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use headless_chrome::browser::default_executable;
use headless_chrome::protocol::cdp::Page::CaptureScreenshotFormatOption;
use headless_chrome::protocol::cdp::types::Event;
use headless_chrome::{Browser, LaunchOptions};

use crate::detect::check::{AuthPageEvidence, ProbeResult, RenderEvidence};
use crate::detect::signatures::signatures;

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
    let screenshot = capture_screenshot(&tab, url);

    let console_errors = console.lock().map(|m| m.clone()).unwrap_or_default();

    Ok(RenderEvidence {
        final_url,
        title,
        probes,
        auth,
        console_errors,
        screenshot,
        render_ms: ms(started.elapsed()),
    })
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
/// `pageProbeScan`: script src substrings, DOM selectors, window
/// globals, per signature.
fn run_page_probe(
    tab: &headless_chrome::Tab,
) -> Result<std::collections::HashMap<String, ProbeResult>, String> {
    let probes: Vec<serde_json::Value> = signatures()
        .iter()
        .map(|s| {
            serde_json::json!({
                "key": s.key,
                "scriptSubstrings": s.script_substrings,
                "selectors": s.selectors,
                "globals": s.globals,
            })
        })
        .collect();
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

/// Viewport screenshot into the working directory, named like the
/// extension's `convertUrlToFilename`: hostname with dots dashed plus
/// the date — which means a same-day re-check overwrites, exactly as
/// the extension documents.
fn capture_screenshot(tab: &headless_chrome::Tab, url: &str) -> Option<String> {
    let hostname = url::Url::parse(url).ok()?.host_str()?.replace('.', "-");
    let (year, month, day) = civil_date_today();
    let filename = format!("scrape-le-{hostname}-{year:04}-{month:02}-{day:02}.png");
    let png = tab
        .capture_screenshot(CaptureScreenshotFormatOption::Png, None, None, true)
        .ok()?;
    std::fs::write(&filename, png).ok()?;
    Some(format!("./{filename}"))
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
}
