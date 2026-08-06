//! scrape-le — check whether a page is scrapeable before the scraper
//! is written. `detect/` decides, `fetch.rs` gathers, `cli.rs` speaks.

use std::process::ExitCode;

mod cli;
mod detect;
mod fetch;
mod render;

fn main() -> ExitCode {
    cli::run()
}
