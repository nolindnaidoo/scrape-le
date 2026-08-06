//! scrape-le — check whether a page is scrapeable before the scraper
//! is written. `detect/` decides, `fetch.rs` and `render.rs` gather,
//! `check_url.rs` is the one path both surfaces call, `cli.rs` and
//! `mcp.rs` are those surfaces, `batch.rs` schedules many of them.

use std::process::ExitCode;

mod batch;
mod check_url;
mod cli;
mod detect;
mod fetch;
mod mcp;
mod render;

fn main() -> ExitCode {
    cli::run()
}
