# scrape-le (CLI) — engineering standards

This is the source of truth for how code in `crate/` is written, tested,
and reviewed. It applies to every contributor, human or AI-assisted. CI
(`.github/workflows/ci-crate.yml`) enforces the mechanical parts;
reviewers enforce the rest. [SPEC.md](SPEC.md) defines the product
behavior — verdicts, exit codes, batching, both surfaces; this file is
how the code gets there. The extension at the repo root is a separate
TypeScript product with its own `AGENTS.md`.

## What this project is

The command-line and MCP frontend of Scrape-LE: load a URL, gather
evidence — headers, status code, robots.txt, raw HTML, rendered DOM —
and return a verdict a script can branch on. One product, two frontends,
one repository: the detection corpus (`../signatures/`, `../fixtures/`)
is shared with the VS Code extension, and CI fails when either side
drifts from it.

**Status: released.** Every detection, both surfaces, batching and the
test layers below are built and green. Releases go out through
`release-crate.yml`, which is dispatch-only and refuses a version that
crates.io already carries, has no changelog entry, or would ship a
tarball missing its own corpus.

## Layout

```
crate/src/
├── detect/       pure: signatures, detectors, verdict, report shape.
│                 No I/O, no browser, pub(crate).
├── fetch.rs      HTTP (ureq) — the --no-render path and robots.txt
├── render.rs     Chromium (headless_chrome), sync CDP
├── check_url.rs  one URL end to end — the only path either surface calls
├── batch.rs      host grouping, bounded concurrency, streaming
├── cli.rs        the terminal surface
└── mcp.rs        the agent surface
```

- **`detect/` touches no network and drives no browser.** It takes
  evidence and returns findings, so the entire decision layer tests
  from a fixture file — no display, no network, no flake. It carries
  the **75% line coverage floor per module**, enforced by the
  `coverage` job. If a `ureq` or `headless_chrome` type appears in
  `detect/`, that is a bug.
- **Both surfaces are one implementation.** `cli.rs` and `mcp.rs` both
  call `check_url.rs`, which calls `check()` in `detect/`. A surface
  that grows its own copy of a rule is a bug, and a contract test
  asserts the two return identical findings for the same URL.
- **`batch.rs` schedules, it does not decide.** Its one rule — never
  two concurrent requests to the same host — is why concurrency is a
  property of the host set and never of the URL count.
- Keep modules flat. No layers, registries, managers, or services. No
  trait with a single implementation.

## Decisions already made (do not relitigate)

- **One crate, no published `-core`.** pixelcoords/pixelactions split
  because pixelactions genuinely consumes `pixelcoords-core`; there is
  no second consumer here, and a published core would hand the
  detection logic to anyone who wants to rebuild this. `detect/` as a
  `pub(crate)` module gives the architectural separation without the
  packaging ceremony.
- **Sync stack: `headless_chrome` + `ureq` + std threads.** No async
  runtime — the batching design (4 concurrent hosts, sequential within
  a host, never two concurrent requests to the same host) needs
  nothing more. Settled by a spike on 2026-08-06: navigate,
  wait-for-load, evaluate, and post-JS DOM snapshot verified against
  real pages, 4 tabs driven from 4 std threads over one browser, and
  the resolved tree is tokio-free.
- **Browser required, never downloaded.** Discovery keeps its own
  candidate list — Chrome, Chromium, Brave, Edge — plus a
  `CHROME`-style env override, because the crate's
  `default_executable()` knows only Chrome/Chromium (verified against a
  Brave-only machine). If none is found, say so and name the fix.
- **`scrape-le.retry.userAgents` is dropped**, deliberately. It
  contradicts the spec's non-goals and the generic-User-Agent rule. A
  written-down parity gap, not an oversight.
- **robots.txt agent-specific groups are fixed here, not ported
  broken.** `--agent` does RFC 9309 group selection; flagless runs stay
  byte-identical to the extension. Corpus cases that diverge carry a
  `divergence` annotation in `../fixtures/`, and a test asserts the CLI
  actually answers what the annotation claims.
- **robots.txt is held per origin, and only when an origin served it.**
  The cache key is scheme + host + port — what decides the URL fetched —
  while `batch.rs` groups on the host alone; politeness is owed to a
  machine, an answer belongs to a document, and the two keys are not
  meant to match. Nothing is kept for a 404, a 5xx, a refusal or a
  timeout: those are asked again by the next URL on the host, because a
  blip that read as "nothing forbids you" for the rest of a batch is the
  one direction this tool may not be wrong in. A run owns one cache
  (`RobotsCache`), passed rather than global, because a run is a batch on
  one surface and a single tool call on the other.
- **stdout is protocol, stderr is human. There is no `--json` flag.**
  One mode, nothing to misremember, and the human summary is a
  projection of the same report so the two cannot drift.
- **Parity scope is detection results only** — the extension's
  `src/detectors/` and `src/utils/url.ts`. Commands, UI, i18n, the
  config reader, and the browser installer are extension concerns with
  no CLI equivalent.

## Control-flow style

Flat over nested, guards over branches — the same rules as pixelcoords
and pixelactions:

- **No statement-position `else`.** Guard clauses and early `return`
  (`if !ok { return ... }` / `let Some(x) = ... else { return }`), then
  fall through to the happy path.
- **Value-position `if/else` is fine** — `let x = if cond { a } else
  { b }` is Rust's ternary.
- **`match` is fine and preferred** over any chain of condition tests
  on the same value; use match guards instead of `if/else` inside arms.
- Prefer combinators where they read cleanly: `bool::then_some`,
  `Option::map/filter/is_some_and`, `?`.
- No nesting deeper than two levels inside a function; extract a named
  helper instead.

## Hard rules

- **No inline `#[allow(...)]`** — CI greps and fails the build. Either
  fix the lint or add a visible, commented relaxation to
  `[lints.clippy]` in `Cargo.toml`.
- **Clippy pedantic, deny warnings.** `cargo clippy --all-targets --
  -D warnings` must pass exactly as CI runs it.
- **No async runtime.** Std threads are the concurrency model. Do not
  add tokio, async-std, or executors — the spec's batching design is
  the proof none is needed.
- **`unsafe` is forbidden crate-wide** (`[lints.rust]`). This tool has
  no OS-API half; there is no platform-module exemption to inherit.
- **Dependencies are a cost.** A browser driver and an HTTP client are
  already more than most tools carry. Justify every addition; prefer
  the standard library; prefer what is already in the tree.
- **Network scope is the URL under check plus that origin's
  `/robots.txt` — nothing else, ever.** Generic User-Agent; no
  telemetry.
- **Strict parsing, never silent defaults.** Bad flags, malformed batch
  input, and unreadable config are errors with actionable messages,
  not fallbacks.
- **Refuse rather than guess.** A page that cannot be reached or
  rendered is a refusal with a reason, never a fabricated verdict.
  Partial evidence is reported as partial — the report says plainly
  when the browser was unavailable. Never report success you did not
  achieve.
- **Refusals speak the caller's vocabulary.** An MCP caller has no
  command line; no message aimed at one mentions `--no-render` or any
  other flag.
- **`analyze_robots_txt` belongs to both servers.** The npm server
  (`src/mcp/tools.ts`) and this one offer the same tool: same schema,
  same envelope, byte-identical output.
  `../fixtures/mcp-analyze-robots.json` runs against both, so changing
  one without the other fails a build. Every tool here returns that
  envelope — `{ ok, data, diagnostics, meta }` — where `ok` means the
  check ran, never that the answer was yes.

## The corpus contract

`signatures/*.toml` and `fixtures/` live inside this crate so the
published package is self-contained — `cargo package` cannot reach above
its own directory, and a crate whose corpus is missing does not build
for a consumer. They are still shared ground: the extension reads the
same files. The crate embeds them in its build and tests;
`../scripts/check-signature-parity.ts` (the `parity` job in
`ci-crate.yml`) fails when the extension drifts. Changing a signature
or a fixture is a behavior change for **both** frontends and needs a
CHANGELOG entry. A `divergence` annotation in a fixture case is the
only sanctioned disagreement.

## Testing

The bar, enforced by review:

- **`detect/`: 75% line coverage floor per module.** Everything in it
  is pure; if something is hard to test there, the design is wrong.
  Per module rather than the crate total, because a total lets one
  module slide while the others carry it.
- **The parity corpus is embedded.** Every `../fixtures/` case runs as
  a unit test; the expected values are the extension's answers except
  where a `divergence` annotation says otherwise.
- **Exit codes belong in `tests/contracts.rs`.** They are the API —
  callers branch on them — so they are pinned by tests that drive the
  built binary against a local fixture server: no browser, no
  internet, so they run everywhere on every push. A new refusal adds
  its case there.
- **Anything needing a real browser is `tests/scenarios.rs`**, gated
  behind `SCRAPE_LE_SCENARIOS` and run by CI on all three OSes. Unit
  tests never launch Chromium, and a skipped scenario is never
  reported as a pass.
- **Every signature carries its negative case.** A signal that
  fingerprints two vendors is a false-positive generator; the corpus
  tests fail the build on an overlapping selector, global or script
  substring, and assert each header rule names exactly one vendor.
- **The verdict rules are held over every combination**, not the cases
  someone thought of: no finding set ever produces `blocked`, and
  `clear` requires zero findings and zero incomplete checks.
- **Every bug fix ships with a regression test** that fails before the
  fix.
- Tests are deterministic: no clocks, no randomness, and **no network
  in unit tests** — robots.txt and header logic run from fixtures.
- **Six more layers, one per class of bug that reached a release**, and
  **none of them touches the network**. Each has its own CI job:
  - `tests/hazards.rs` — inputs a real machine holds and a fixture
    directory cannot: a byte-order mark, an undecodable file, a FIFO, a
    symlink loop, a 260-character path, aimed at `--signatures` and at a
    batch whose every entry is malformed. Built at runtime, because
    Windows cannot check half of it into git, and every case the
    platform cannot express is skipped **by name**.
  - `tests/platform.rs` — the paths the tool prints, `TZ` independence,
    a case-folding filesystem, reserved Windows names, stdin closed
    early. The one path the *report* carries is the screenshot name,
    whose shape is pinned by a unit test on the pure builder because
    producing one needs a browser.
  - `../scripts/check-differential.ts` — generated robots.txt documents
    through **both** MCP servers. Scoped to the shared tool; see
    SPEC.md, "Deliberate divergences". `matchHeaders` is not reachable
    there and the script says so rather than skipping it silently.
  - `tests/fuzz.rs` — time-boxed against the robots parser and the URL
    validator through `analyze_robots_txt`, with a deadline per case:
    every pattern becomes a regex, so a hang is a real failure mode.
  - `tests/budget.rs` — a wall-clock ceiling, and linearity in **both**
    directions: four times the documents, and four times the rules in
    one document.
  - `coverage_matrix` (in `detect/check.rs` and `render.rs`) — every
    vendor reachable through every signal it declares, every declared
    signal reaching the page probe, every check and verdict reachable.
    A vendor in the corpus that nothing can surface inflates what the
    tool says it covers.

## Verification — the definition of done

All of it, exactly as CI runs it, before every push:

```bash
cargo fmt --all --check
cargo clippy --all-targets -- -D warnings
cargo test --locked
bun ../scripts/check-signature-parity.ts   # when detection data changed
```

CI additionally builds on macOS, Windows, and Linux, checks the Rust
1.88 minimum version, runs `cargo audit` and the no-inline-`#[allow]`
policy job, and runs parity — including on extension-side edits to
`src/detectors/**` and `src/utils/url.ts`, so neither frontend can
drift green. A change is not done because it compiles; it is done when
it is tested, linted, documented where behavior changed (README /
CHANGELOG / this file), and honest — claims in docs must match the
code.

## Commits and pull requests

The repo root's convention applies unchanged (root `AGENTS.md`):
conventional prefix, imperative subject, body carrying the *why* —
enforced by the `commit-msg` hook and the `Commit messages` CI job.
One concern per change; if docs describe the thing you changed, update
them in the same commit. Release tags are `crate-v*`, and a release
goes out by dispatching `release-crate.yml` with its publish opt-in —
never by pushing a tag, because a crates.io version can never be
reused.
