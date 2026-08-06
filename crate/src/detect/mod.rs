//! The pure decision layer: signatures, detectors, verdict, report.
//! No I/O, no browser — evidence in, findings out — so everything here
//! tests from the fixture corpus at `../fixtures/`. `fetch.rs` (and
//! later `render.rs`) gather the evidence; both surfaces call
//! `check()` and nothing else.

pub(crate) mod antibot;
pub(crate) mod auth;
pub(crate) mod check;
pub(crate) mod ratelimit;
pub(crate) mod report;
pub(crate) mod robots;
pub(crate) mod signatures;
pub(crate) mod url;
