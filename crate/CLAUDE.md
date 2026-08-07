# Instructions for AI coding assistants

Read [AGENTS.md](AGENTS.md) first — it is the engineering-standards
document for this crate and the source of truth for layout,
control-flow style, the settled decisions, testing requirements, and
the definition of done. [SPEC.md](SPEC.md) defines the product
behavior. AGENTS.md wins on any conflict. The extension at the repo
root is a separate product with its own `CLAUDE.md`.

- Before declaring any change complete, run exactly what CI runs:
  `cargo fmt --all --check`,
  `cargo clippy --all-targets -- -D warnings`,
  `cargo test --locked`. All three must pass — and
  `bun ../scripts/check-signature-parity.ts` when detection data
  changed.
- Never add inline `#[allow(...)]` — CI fails the build on it. Fix the
  lint, or add a commented relaxation to `[lints.clippy]` in
  `Cargo.toml`.
- New logic goes in `detect/` when it is pure (it must then be
  unit-tested, 90% module coverage floor), and in `fetch.rs` /
  `render.rs` only when it needs the network or the browser.
- `../signatures/` and `../fixtures/` are shared with the extension —
  changing them changes both frontends and needs a CHANGELOG entry.
- Write regression tests for every bug you fix; keep unit tests free
  of clocks, randomness, and the network.
- Browser behavior cannot be verified by reading code: run it, or say
  plainly that it needs a run. Never claim rendering works without one.
