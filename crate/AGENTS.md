# AGENTS.md — scrape-le (CLI)

Technical source of truth for the Rust CLI. [SPEC.md](SPEC.md) defines
the product behavior — verdicts, exit codes, batching, the MCP surface;
this file is for anyone changing the code. The extension at the repo
root has its own `AGENTS.md`; the root docs stay TypeScript-scoped.

## What this is

The command-line frontend of Scrape-LE: the same question the VS Code
extension answers — can this page be scraped, and what would block a
scraper — asked from a terminal or an agent loop. One product, two
frontends, one repository, so the detection corpus cannot drift.

## Decisions already made

Do not relitigate these; each was settled with reasoning on record.

- **One crate, no published `-core`.** `detect/` is a `pub(crate)`
  module carrying a 90% per-module line coverage floor (enforced in CI
  once the port lands).
- **Sync stack, no async runtime.** `headless_chrome` (sync CDP) +
  `ureq` + std threads. The batching design — 4 concurrent hosts,
  sequential within a host — needs no runtime, and the resolved tree
  must stay tokio-free. Settled by a spike on 2026-08-06: navigate,
  wait-for-load, evaluate and post-JS DOM snapshot all verified, plus
  4 tabs driven from 4 std threads over one browser.
- **Browser discovery is ours.** `default_executable()` knows only
  Chrome/Chromium; discovery keeps its own candidate list (Chrome,
  Chromium, Brave, Edge) plus a `CHROME`-style env override. Required,
  never downloaded — if none is found, say so and name the fix.
- **Parity scope is detection results only** — `src/detectors/` and
  `src/utils/url.ts`. Commands, UI, i18n, the config reader and the
  browser installer are extension concerns with no CLI equivalent.
- **`scrape-le.retry.userAgents` is dropped**, deliberately. It
  contradicts the spec's non-goals and the generic-User-Agent rule.
  A written-down parity gap, not an oversight.
- **robots.txt agent-specific groups are fixed here, not ported
  broken.** `--agent` does RFC 9309 group selection; the extension
  evaluates only `User-agent: *`. Corpus cases that diverge carry a
  `divergence` annotation in `../fixtures/`.

## The corpus contract

`../signatures/*.toml` and `../fixtures/` are shared ground — neither
frontend owns them. The crate embeds them in its build and tests;
`../scripts/check-signature-parity.ts` (CI: `ci-crate.yml`) fails when
the extension drifts. Changing a signature or a fixture is a behavior
change for **both** frontends and needs a CHANGELOG entry.

## Standards

The pixelcoords/pixelactions rules apply verbatim:

- **Refuse rather than guess.** An answer this tool cannot stand behind
  is a refusal with a reason, never a fabricated verdict. Exit codes
  are the API; scripts branch on them (see SPEC.md).
- **Dependencies are a cost.** A browser driver and an HTTP client are
  already more than most tools carry. No async runtimes, no
  single-implementation traits, no architectural layers.
- **No inline `#[allow]`** — CI fails the build on it. Fix the lint or
  add a commented relaxation to `[lints.clippy]` in `Cargo.toml`.
- **Unsafe is forbidden** (`[lints.rust] unsafe_code = "forbid"`).
- Before declaring any change complete, run what CI runs:
  `cargo fmt --all --check`, `cargo clippy --all-targets -- -D warnings`,
  `cargo test --locked`. All three must pass.
- Comments explain **why**, never what.

## Toolchain

- Edition 2024, `rust-version = "1.88"` (CI checks it), stable for
  development. `Cargo.lock` is committed — this is a binary.
- CI: `.github/workflows/ci-crate.yml` — fmt, clippy as errors, test
  and build on three OSes, MSRV, the no-inline-allow policy check,
  `cargo audit`, and the parity job. It also triggers on
  `src/detectors/**` and `src/utils/url.ts`, because parity must fail
  when either side drifts.
- Releases tag `crate-v*` (extension tags stay `vscode-v*`-free,
  hand-applied). Publishing is deferred; no release workflow exists
  yet, deliberately.
