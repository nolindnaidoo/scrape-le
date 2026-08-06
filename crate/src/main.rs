//! scrape-le CLI — scaffolding.
//!
//! The detection engine ports from the extension (`../src/detectors/`,
//! `../src/utils/url.ts`) against the shared corpus in `../signatures/`
//! and `../fixtures/`. Until it lands, the binary refuses honestly
//! rather than answering wrongly.

fn main() {
    eprintln!(
        "scrape-le {}: not implemented yet — the detection engine has not been ported",
        env!("CARGO_PKG_VERSION")
    );
    std::process::exit(2);
}
