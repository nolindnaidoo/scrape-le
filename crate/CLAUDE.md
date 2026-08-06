# CLAUDE.md

[AGENTS.md](AGENTS.md) is the technical source of truth for the CLI:
the settled decisions (sync stack, one crate, parity scope, the corpus
contract), the pixelcoords-grade standards, and the toolchain.
[SPEC.md](SPEC.md) defines the product behavior. Read both before
writing code.

Non-negotiables, restated for emphasis — the standard itself lives in
AGENTS.md:

- Refuse rather than guess; exit codes are the API.
- No async runtime, no inline `#[allow]`, no unsafe.
- `../signatures/` and `../fixtures/` are shared with the extension;
  changing them changes both frontends.
- Gates: `cargo fmt --all --check`, `cargo clippy --all-targets --
  -D warnings`, `cargo test --locked`.
