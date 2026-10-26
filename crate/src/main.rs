//! scrape-le — check whether a page is scrapeable before the scraper
//! is written. `detect/` decides, `fetch.rs` and `render.rs` gather,
//! `check_url.rs` is the one path both surfaces call, `cli.rs` and
//! `mcp.rs` are those surfaces, `batch.rs` schedules many of them.

use std::process::ExitCode;

/// A line on stderr that a reader may have stopped reading.
///
/// `eprintln!` panics when the write fails, and a reader that closed the
/// stderr pipe turned every refusal into exit 101 with a panic message
/// nobody saw: `--not-a-flag` under such a reader exited 101, not 2.
/// Nothing on stderr is protocol, so a write that fails is dropped, as
/// the npm command line drops it. Defined before the modules so each of
/// them can use it.
macro_rules! stderr_line {
    ($($arg:tt)*) => {{
        use std::io::Write as _;
        let _ = writeln!(std::io::stderr(), $($arg)*);
    }};
}

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
