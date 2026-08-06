//! The spike that settled the sync-stack decision (2026-08-06): proves
//! `headless_chrome` covers everything `render.rs` needs — navigate,
//! wait-for-load, `evaluate`, post-JS DOM snapshot — and that std
//! threads drive concurrent tabs over one browser without a runtime.
//! Kept as the seed for `render.rs` and the scenario tests.
//!
//! Run: `cargo run --example spike [-- URL...]` — extra URLs are
//! checked after the built-in pages. Touches the network; never run
//! by CI (CI only compiles it).

use std::time::{Duration, Instant};

use anyhow::Result;
use headless_chrome::browser::default_executable;
use headless_chrome::{Browser, LaunchOptions, Tab};

/// `default_executable()` knows Chrome/Chromium but not Brave/Edge —
/// the finding that put a candidate list into the browser-discovery
/// decision. The fallback keeps the spike honest on a Brave-only
/// machine until `doctor` exists.
const BRAVE_MACOS: &str = "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";

const DATA_URL: &str = "data:text/html,<div id='x'>before</div>\
     <script>document.getElementById('x').textContent='after';window.__spike=42;</script>";

fn main() -> Result<()> {
    let exe = default_executable().unwrap_or_else(|_| BRAVE_MACOS.into());
    println!("browser: {}", exe.display());

    let t0 = Instant::now();
    let browser = Browser::new(
        LaunchOptions::default_builder()
            .path(Some(exe))
            .headless(true)
            .idle_browser_timeout(Duration::from_secs(120))
            .build()
            .map_err(anyhow::Error::msg)?,
    )?;
    println!("launch: {:?}\n", t0.elapsed());

    // Deterministic first: a data: URL with a JS DOM mutation proves
    // evaluate + post-JS snapshot with no network involved.
    let tab = browser.new_tab()?;
    let t = Instant::now();
    tab.navigate_to(DATA_URL)?;
    tab.wait_until_navigated()?;
    let global = tab.evaluate("window.__spike", false)?.value;
    let dom = tab.get_content()?;
    let mutated = if dom.contains("after") {
        "PASS"
    } else {
        "FAIL"
    };
    println!(
        "[data-url] {:?}  window.__spike={global:?}  post-js snapshot: {mutated}",
        t.elapsed(),
    );

    let defaults = ["https://example.com".to_string()];
    let args: Vec<String> = std::env::args().skip(1).collect();
    let urls = if args.is_empty() {
        &defaults[..]
    } else {
        &args[..]
    };
    for url in urls {
        check_page(&browser, url)?;
    }

    // 4 tabs on 4 std threads over one browser: the concurrency model
    // the batching design assumes, with no runtime anywhere.
    let t = Instant::now();
    std::thread::scope(|s| {
        for i in 0..4 {
            let browser = &browser;
            s.spawn(move || {
                let tab = browser.new_tab().expect("new_tab");
                tab.navigate_to(&format!("data:text/html,<script>window.__n={i};</script>"))
                    .expect("navigate");
                tab.wait_until_navigated().expect("wait");
                let v = tab.evaluate("window.__n", false).expect("evaluate").value;
                println!("[thread {i}] window.__n={v:?}");
            });
        }
    });
    println!("\n4 tabs / 4 std threads: {:?}", t.elapsed());
    Ok(())
}

fn check_page(browser: &Browser, url: &str) -> Result<()> {
    let tab: std::sync::Arc<Tab> = browser.new_tab()?;
    let t = Instant::now();
    tab.navigate_to(url)?;
    tab.wait_until_navigated()?;
    tab.wait_for_element("body")?;
    let nav = t.elapsed();
    let title = tab.get_title()?;
    let final_url = tab.get_url();
    let globals = tab
        .evaluate(
            "JSON.stringify({webdriver:navigator.webdriver,\
             chrome:typeof window.chrome,ready:document.readyState,\
             scripts:document.getElementsByTagName('script').length})",
            false,
        )?
        .value;
    let dom = tab.get_content()?;
    println!(
        "[{url}] nav+wait {nav:?}\n  final-url: {final_url}\n  title: {title:?}\n  probe: {globals:?}\n  rendered DOM: {} bytes",
        dom.len()
    );
    Ok(())
}
