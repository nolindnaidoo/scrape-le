//! scrape-le CLI. The detection layer (`detect/`) is landing module by
//! module against the shared corpus; until the surfaces exist the
//! binary refuses honestly rather than answering wrongly.

mod detect;

fn main() {
    eprintln!(
        "scrape-le {}: not implemented yet — {} vendor signatures embedded, surfaces not wired",
        env!("CARGO_PKG_VERSION"),
        detect::signatures::signatures().len()
    );
    std::process::exit(2);
}
