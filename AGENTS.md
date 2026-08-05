# AGENTS.md — Scrape-LE

Technical source of truth for this repo. README.md is the user-facing doc; this file is for anyone (human or agent) changing the code.

## What this is

A VS Code extension that loads a URL in headless Chromium (playwright-core) and reports what would block a scraper: HTTP status/title/load time, console errors, a full-page screenshot, anti-bot vendor detection, rate-limit headers, robots.txt evaluation, and authentication walls. Network access is scoped to the URL under check plus that origin's `/robots.txt` — nothing else, ever.

## Architecture

```
extension.ts             activate(): createNotifier() + createStatusBar() -> registerCommands()
commands/                one file per command; deps injected as a frozen bag
  check.ts               checkUrl prompt + executeCheck orchestration (progress, status bar, output)
  checkSelection.ts      extracts a URL from the selection, reuses executeCheck
  setup.ts               browser install/verify quick pick
  help.ts                opens the help markdown document
scraper/
  browser.ts             chromium.launch wrapper (headless, hardened args)
  checker.ts             page load ('load' + best-effort 5s networkidle), console capture,
                         screenshot (format/quality), runs detections
  install.ts             async browser install via bundled playwright-core CLI in a child
                         Node process (ELECTRON_RUN_AS_NODE); manual command pinned to the
                         shipped playwright-core version
detectors/
  heuristics.ts          THE vendor signature table + single-evaluate page probe
  antibot.ts             header pass + one page.evaluate for all vendors
  ratelimit.ts           X-RateLimit / RateLimit / Retry-After headers + HTTP 429
  robotstxt.ts           RFC 9309 groups, Allow/Disallow longest-match, * and $ patterns
  authentication.ts      401/403, login forms, keywords, path-segment URL check
  index.ts               runDetections: enabled detectors in parallel, failures isolated
ui/                      notifier (notificationsLevel re-read per call: all -> everything,
                         important -> warn+error, silent -> error only), statusBar (owns
                         visibility, follows statusBar.enabled live), output channel
config/config.ts         getConfiguration() snapshot; DEFAULT_CONFIG table
utils/                   url (validate/normalize/extract/filename), errorHandling
                         (sanitizeErrorMessage wired into user-facing errors)
types.ts                 shared types only — no logic
```

Conventions: factory functions + `Object.freeze` (no classes), guard clauses, dependency bags typed inline at the consumer — see **Code style** below. Both the manifest and the runtime strings are localized into 12 locales; see **Toolchain**.

## Code style

The full standard, with the reasoning behind each rule, is
[`../AGENTS.md`](../AGENTS.md). It is not optional and it applies to every
change in this repo. In short:

- **Guard clauses first, then the work.** Preconditions return immediately; the
  happy path runs at one indent level.
- **No `else`, no `else if`.** Two branches are an early return; many are a
  lookup table or a `switch` that returns from every arm.
- **Two levels of nesting, maximum.** A third means the inner block wants to be
  its own named function.
- **Truthy checks** (`if (!value)`) — except where `0`, `''` or `false` are
  legitimate values, which are tested explicitly. All three have been live bugs
  here.
- **Immutable by default:** `readonly` fields, `ReadonlyArray`, `Object.freeze`
  on returned objects, never mutate a parameter.
- **Composition, never inheritance.** Factory functions returning frozen
  objects; dependencies arrive as a typed bag so tests need no framework.
- **Logic and presentation stay apart.** Extraction, analysis and conversion
  return data and never touch `vscode.window.*`; `ui/` renders, `commands/`
  orchestrates. A logic module should be testable without the `vscode` mock.
- **Commands are thin** — read config, call logic, hand off to the UI layer,
  handle failure.
- **No god files** (~300 lines is the smell), and `types.ts` holds types only.
- **Define it once.** Duplicate regexes and helpers have each shipped as a bug
  here, because copies drift and only one copy gets fixed.
- **Complete, descriptive error handling.** Never swallow, never report success
  you did not achieve — check what the API returned.
- **Comments explain why, never what.**

## Invariants (things that were once broken — keep them true)

- **The bundle must be self-contained except playwright-core.** v1.x shipped tsc output requiring `node_modules` that the VSIX excluded — no published version could activate. `scripts/check-bundle.js` (run in `vscode:prepublish` and CI) does a static require scan, loads the bundle with `vscode` stubbed, and verifies `.vscodeignore` allow-lists `node_modules/playwright-core/`. playwright-core cannot be bundled (optional chromium-bidi requires, `require.resolve` asset paths) and ships whole in the VSIX.
- **`DEFAULT_CONFIG` must equal package.json defaults.** `config.test.ts` asserts parity over every declared setting; add new settings to both plus the KEY_MAP in the test.
- **Every declared setting must have a consumer.** v1.x declared screenshot format/quality and then ignored them; don't add a setting without wiring it.
- **Detector behavior is pinned by golden snapshots** (`detectors/characterization.test.ts` + `__fixtures__/`). Any output change must update goldens in the same commit and be listed in the CHANGELOG.
- **Anti-bot signatures live in one place** (`detectors/heuristics.ts`), probed with a single `page.evaluate`. Never re-implement a per-vendor scan inside a detector, and never add ambiguous markers (bare `[data-sitekey]`, plain `gstatic.com`) that fingerprint more than one vendor.
- **nls catalogues stay in key-parity:** all 12 locale files carry exactly the keys of `package.nls.json` and the manifest uses exactly those keys (`src/i18n/nls-parity.test.ts`).
- **No test touches the network.** robots.txt tests stub `fetch`; command tests mock the scraper modules; browser install is never executed by tests.
- **Errors shown to users pass through `sanitizeErrorMessage`** (home directories, credential-shaped fragments).

## Toolchain

- **Runtime targets:** `engines.vscode` is the supported floor and `@types/vscode` is pinned to it **exactly**. A caret there lets the type surface drift ahead of the version users actually run, so code compiles against APIs that are not there at runtime. Dependabot is configured to never bump it.
- **Build:** esbuild bundle (`bun run build`, `build:prod` minified). `tsc` is typecheck-only (`noEmit`) and covers test files. TypeScript 7.
- **Unit tests:** vitest 4; `vscode` aliased to `src/__mocks__/vscode.ts` (stateful mock with `_reset/_set` helpers). Coverage provider `istanbul`, thresholds enforced at **75 lines / 80 functions / 60 branches / 75 statements**. These are a floor to ratchet upward, never to lower so a build passes.
- **Integration tests:** `bun run test:integration` — `@vscode/test-cli` launches a real VS Code (config in `.vscode-test.mjs`, tests compiled via `tsconfig.it.json` to `out-test/`). That project targets `node16` module resolution; TypeScript 7 removed `node10`, which `"Node"` resolved to.
- **Installed-VSIX tests:** `bun run test:e2e-vsix` installs the built `.vsix` into a clean VS Code profile and drives it. This is the only test that exercises the artifact users receive, and it runs in CI.
- **Lint/format:** Biome (tabs, single quotes). `__fixtures__`/`__snapshots__` are exempt — formatting fixtures would corrupt goldens. `biome.json` is byte-identical across all ten repos; change it in one and copy it to the rest.
- **Packaging:** `bun run package` → `release/*.vsix`. `.vscodeignore` is an allow-list; the VSIX is 78 files, most of them `playwright-core` — this is the one extension that ships a runtime dependency, so it packages **with** the npm tree while the other nine use `--no-dependencies`.
- **Localization:** two separate mechanisms. The 12 `package.nls.*.json` catalogues in `src/i18n/` localize **manifest** strings (VS Code `%key%` substitution) and are copied to the package root at prepublish, then removed by `clean:i18n`. The 12 `l10n/bundle.l10n.*.json` catalogues localize **runtime** strings via `vscode.l10n.t()`, enabled by `"l10n": "./l10n"` in package.json. They fail independently: a working manifest says nothing about the runtime bundles. See [../AGENTS.md](../AGENTS.md) for the rules that keep both correct.

## Generated documentation

Two README sections are generated. Do not hand-edit the content between their markers.

- `bun run test:coverage && bun run coverage:readme` writes the Testing section from `coverage/coverage-summary.json`. CI runs `coverage:readme:check`, which fails when the committed numbers no longer match a real run — coverage is compared within 1 percentage point (it is not bit-identical across machines), while test counts are derived from source and must match exactly.
- `bun run benchmark && bun run perf:readme` writes the Performance section from a real run of the extraction entry point. This is **not** checked in CI: throughput is machine-specific, so a hosted runner would fail it for reasons that say nothing about the code. The host is printed with the numbers instead.

The pre-2.0 README carried hand-written test counts and throughput figures that drifted until they were false. Generating them is what stops that recurring.

## Security & automation

- **CodeQL** runs on push, PR and weekly (`javascript-typescript` + `actions`), configured in `.github/codeql-config.yml`. Test files and fixtures are excluded on purpose: they contain inputs that are supposed to look dangerous, and scanning them produces findings that can only ever be dismissed.
- **Dependabot** (`bun` ecosystem, not `npm` — the npm updater rewrites `package.json` without regenerating `bun.lock`, so its PRs can never pass the frozen-lockfile gate) opens grouped weekly PRs.
- **Auto-merge** is workflow-driven, not GitHub-native: `main` has no required status checks, so native auto-merge would land a PR before CI started. `dependabot-auto-merge.yml` waits for the CI run to conclude and merges only patch/minor **devDependency** updates. Runtime dependencies bundle into the shipped VSIX and always need a human.
- **Actions are pinned to commit SHAs.** A tag is mutable and this repo holds a publish token. The trailing `# vX.Y.Z` comment is what Dependabot reads and rewrites.
- **Branch safety:** a `main-safety` ruleset blocks deletion and force-push. Pushes to `main` are otherwise unrestricted by design.
- Secret scanning and push protection are enabled. `VSCE_PAT` and `OVSX_PAT` live in repo secrets and in Doppler (`extensions` / `prd`).

## Release

1. Bump `version` in package.json and write the CHANGELOG entry. The entry must describe what actually changed, including bug fixes — it ships inside the VSIX and renders on the listing page.
2. Regenerate the README sections (`coverage:readme`, and `perf:readme` if behaviour changed) and commit them.
3. CI green on all three OSes. That includes lint, typecheck, coverage, the bundle gate, packaging, integration tests, and the installed-VSIX e2e.
4. Tag the commit being released, so the tag is the artifact rather than an approximation of it.
5. Dispatch the `Release` workflow. It takes two independent opt-ins — `marketplace` (default **on**) and `openvsx` (default **off**) — because a version cannot be republished, so a run that publishes one registry and fails on the other is only recoverable by re-running with the failed target alone. It validates credentials before doing anything irreversible.

**Open VSX defaults off deliberately.** `ovsx publish` takes no namespace argument; it derives the namespace from `publisher` in the VSIX. Enabling it publishes to whatever `package.json` currently names, with no confirmation.

## Known limitations (documented, not bugs)

- Anti-bot signatures are best-effort fingerprints of public
  integration patterns; vendors change them, and first-party proxied
  setups can evade them. Detection means "can challenge you", not
  "will"; absence is not permission to scrape.
- robots.txt: agent-specific groups are ignored — only the
  `User-agent: *` rules are evaluated and reported.
- Detections run after `load` + a ≤5s network-idle settle; content
  rendered later can be missed by page-level probes.
- The in-page probe (`pageProbeScan`) executes in the browser; unit
  tests cover it with stubbed DOM globals, not a real DOM.
- Screenshot filenames embed hostname + date, so same-day re-checks of
  a URL overwrite the previous screenshot.
