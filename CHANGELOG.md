# Changelog

All notable changes to Scrape-LE will be documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.2] - 2026-08-04

### Added

- Dependency review on pull requests, failing on a high-severity addition
  before Dependabot's auto-merge can act.

### Changed

- CI gains fleet-wide checks that no single repo can perform: shared config is
  compared across all ten extensions, and every README link is verified —
  including Open VSX links, which are checked against the API because
  open-vsx.org answers HTTP 200 for extensions that do not exist.

## [2.0.1] - 2026-08-04

### Changed

- Marketplace categories re-targeted for discovery. `Other` is dropped
  (65,992 extensions, no discovery value); each extension now sits in
  categories matching how it is actually used.
- Search keywords widened to 30, targeting the terms users actually type
  rather than internal vocabulary.
- Toolchain moved to current: TypeScript 7, vitest 4, Biome 2.5.7,
  @types/node 26. `@types/vscode` is now pinned exactly to the
  `engines.vscode` floor — the caret had let the type surface drift 15
  minors ahead of the version actually supported.
- Runtime dependencies updated across majors where present: csv-parse 7,
  ini 7, js-yaml 5. Extraction output is unchanged, verified against the
  characterization goldens.
- Packaging no longer walks the npm tree (`vsce package --no-dependencies`).
  The bundle is self-contained, so the walk served no purpose and failed
  after any dependency change. Scrape-LE keeps it, since it genuinely
  ships `playwright-core`.
- Documentation claims corrected against the code. Removed: Numbers-LE
  "with statistics", EnvSync-LE "visual diffs", Regex-LE "live feedback",
  String-LE "and validation" — none of those features exist.

### Added

- Rating links in the in-extension help output, for both the VS Code
  Marketplace and Open VSX. Acquisitions exceed listing page views, so most
  users never see the listing's rating control; help is the surface they do
  reach.
- README now carries measured Performance and Testing sections, both
  generated rather than written — from `scripts/benchmark.ts` and from the
  coverage summary. CI fails if the coverage numbers drift from a real run.
- Coverage thresholds enforced at 75 lines / 80 functions / 60 branches /
  75 statements.
- CodeQL scanning, Dependabot with grouped weekly updates, and auto-merge
  limited to patch and minor devDependency bumps that pass CI.

## [2.0.0] - 2026-07-30

Full rehabilitation release. The headline fix: **v1.x VSIXes could not
activate at all** — the build shipped per-file `tsc` output that
`require`d `vscode-nls` and `playwright-core` at runtime while
`.vscodeignore` excluded `node_modules` from the package. Every install
from the marketplace was dead on arrival.

### Fixed

- **Packaging**: esbuild now produces a self-contained bundle
  (playwright-core ships alongside it in the VSIX — it cannot be
  bundled); a three-part bundle gate (static require scan, runtime load
  with `vscode` stubbed, packaging allow-list check) runs in
  `vscode:prepublish` and CI. The old package also leaked
  `.claude/settings.local.json`, `ENTERPRISE_QUALITY.md`, `.mailmap`,
  and `.vscode/` into the VSIX; packaging is now an allow-list.
- **`scrape-le.exportResults`** appeared in the command palette but was
  never implemented — invoking it errored with "command not found".
  Removed from the manifest.
- **`screenshot.format` / `screenshot.quality` were ignored**:
  screenshots were always PNG at default compression. Both settings now
  reach Playwright (`.jpg` extension and quality for JPEG).
- **`notificationsLevel` / `statusBar.enabled` were read once at
  activation**: changing either required a reload, and the status bar
  re-appeared during checks even when disabled. Both now apply live.
- **Browser install froze the extension host**: `execSync('npx
  playwright install chromium')` blocked the UI for the entire ~130MB
  download and depended on `npx`. The install now runs the bundled
  playwright-core CLI asynchronously in a child process, and manual
  instructions pin the exact playwright-core version so the downloaded
  Chromium build always matches the library.
- **Runtime localization never worked**: `vscode-nls` was configured
  without a file argument, so users always saw the inline English
  strings. The dead layer is removed; the English strings stay; the 13
  manifest catalogues (a separate, working mechanism) remain.

### Changed — detection behavior ledger

- **Perimeter81 → PerimeterX**: v1.x fingerprinted "Perimeter81", a
  VPN/SASE product that is not a bot-protection vendor, via headers
  that identify neither. Result field `antiBot.perimeter81` is now
  `antiBot.perimeterx` with real PerimeterX signatures.
- **reCAPTCHA false positives removed**: any `gstatic.com` script
  (e.g. Google Fonts) and any bare `[data-sitekey]` element (also used
  by hCaptcha and Turnstile) no longer count as reCAPTCHA.
- **Cloudflare**: challenge-page signatures added
  (`challenges.cloudflare.com`, `.cf-turnstile`, `#challenge-form`,
  `cf-mitigated` header).
- **robots.txt** now follows RFC 9309: consecutive `User-agent` lines
  form one group (v1.x missed rules when `*` was not the last grouped
  line), `Allow` rules participate with longest-match semantics (v1.x
  ignored `Allow`), `*` wildcards and `$` anchors match (v1.x compared
  literal prefixes, so `/private*` never matched anything), inline `#`
  comments are stripped, all `Sitemap` entries are collected (result
  field `sitemap` → `sitemaps: string[]`), and crawl-delay accepts
  decimals.
- **Rate limiting**: HTTP 429 counts as rate-limited even without
  advertised headers.
- **Authentication**: URL heuristic matches whole path segments —
  `/author/...` no longer counts toward "authentication required";
  `sign-in` added to the segment list.
- **Navigation**: waits for `load` plus a best-effort 5s network-idle
  settle instead of full `networkidle` — pages with long-polling or
  analytics no longer burn the whole timeout and fail the check.
- **`notificationsLevel: silent`** now means errors-only (previously it
  suppressed errors too, making failures invisible).
- Detail strings normalized to `<Vendor> (<mechanism>)`.

### Removed

- Fabricated documentation: `ENTERPRISE_QUALITY.md`, `docs/`
  (invented performance metrics, governance theater), `sample/`, and
  the help page's phantom features (export results, "Use Playwright"
  toggle, telemetry and export-format settings that never existed).
- Dead code: `utils/performance.ts` (448 lines, zero importers),
  unused export bags, `detection.logic.test.ts` (46 "tests" that
  imported nothing from the codebase and asserted on their own inline
  literals).
- `vscode-nls` dependency, legacy `onCommand` activation events,
  invalid top-level `l10n` field.

### Added

- Characterization golden suite pinning detector output per fixture.
- Config-defaults parity test across every declared setting, and an
  nls-parity test across all 13 catalogues.
- Integration tests in a real extension host; 3-OS CI with bundle gate
  and VSIX artifact; manual-dispatch release workflow (vsce + ovsx).
- Coverage thresholds enforced (80% lines / 80% functions / 75%
  branches / 80% statements).

### Migration notes

- The publisher changed: the extension id is now
  `nolindnaidoo.scrape-le`, and installs under the previous id will not
  auto-update to this version.
- Minimum VS Code is now 1.90.
- If you parse the output programmatically: `antiBot.perimeter81` →
  `antiBot.perimeterx`, `robotsTxt.sitemap` → `robotsTxt.sitemaps`.

## Pre-2.0 releases

Entries for 1.0.0–1.8.1 have been removed: they described features
that did not exist (settings export, telemetry controls), test counts
padded by suites that tested nothing, and coverage numbers that could
not be reproduced — and every 1.x package was unable to activate in
the first place. See git history for the raw entries.
