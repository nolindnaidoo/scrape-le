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
  **What they hold equal is the shared `analyze_robots_txt` MCP tool**,
  which must answer identically from either server; a difference there is
  a bug. The surfaces themselves are IDE-first and terminal-first and are
  meant to differ — batch input, exit codes and JSON Lines have no editor
  equivalent and are not drift. SPEC.md's "Deliberate divergences" is the
  bar for a new one.
- Write regression tests for every bug you fix; keep unit tests free
  of clocks, randomness, and the network.
- Browser behavior cannot be verified by reading code: run it, or say
  plainly that it needs a run. Never claim rendering works without one.
