//! The pure decision layer: signatures, header matching, robots.txt,
//! URL utilities. No I/O, no browser — evidence in, findings out — so
//! everything here tests from the fixture corpus at `../fixtures/`.
//! `fetch.rs` and `render.rs` gather the evidence; the surfaces call
//! `check()` once it exists.

pub(crate) mod antibot;
pub(crate) mod robots;
pub(crate) mod signatures;
pub(crate) mod url;
