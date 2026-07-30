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

Conventions: factory functions + `Object.freeze` (no classes), early returns, dependency bags typed inline at the consumer. Runtime strings are plain English; the 13 `package.nls*.json` catalogues localize **manifest** strings only (VS Code `%key%` substitution — do not add a runtime i18n layer without wiring real bundles).

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

- **Build:** esbuild bundle (`bun run build`, `build:prod` minified), `--external:vscode --external:playwright-core`. `tsc` is typecheck-only (`noEmit`) and covers test files.
- **Unit tests:** vitest; `vscode` aliased to `src/__mocks__/vscode.ts` (stateful mock with `_reset/_set` helpers). Coverage thresholds enforced: 80 lines / 80 funcs / 75 branches / 80 stmts. Run without `--bun` — the v1.x `bun --bun vitest` script crashed the worker pool.
- **Integration tests:** `bun run test:integration` — `@vscode/test-cli` (≥0.0.15, with `@vscode/test-electron` ≥3) launches a real VS Code; config in `.vscode-test.mjs`, tests compiled via `tsconfig.it.json` to `out-test/`.
- **Lint/format:** Biome (tabs, single quotes). `__fixtures__`/`__snapshots__`/`__mocks__`/`__data__` are excluded in `biome.json` `files.includes` — formatting fixtures would corrupt goldens.
- **Packaging:** `bun run package` → `release/*.vsix`. `.vscodeignore` is an allow-list; the VSIX is ~21 extension files + the playwright-core tree (~360 files total, ~2.5MB).

## Release

1. Bump `version` in package.json, add a CHANGELOG entry (detection
   output changes go in a behavior ledger section).
2. CI green on all 3 OSes (includes packaging + integration tests).
   Locally, `bun run package && bun run test:e2e-vsix` proves the
   actual VSIX installs and activates in a clean VS Code profile.
3. `Release` workflow (manual dispatch) publishes to the VS Code
   Marketplace (`VSCE_PAT`) and Open VSX (`OVSX_PAT`) — Open VSX is
   what Cursor/VSCodium users install from.

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
