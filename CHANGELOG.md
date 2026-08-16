# Changelog

All notable changes to Scrape-LE will be documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.2.6] - 2026-08-16

### Fixed

- **A non-ASCII robots.txt rule did not match the path the browser
  actually requests.** RFC 9309 §2.2.2 is explicit: octets outside ASCII
  "MUST be percent-encoded … prior to comparison". `Disallow: /café`
  refused `/café` and allowed `/caf%C3%A9` — the same resource, two
  answers, and the *allowed* one is the spelling that reaches the
  matcher on every real check, because `URL.pathname` encodes. Python's
  `RobotFileParser` refuses both. Rules and paths are now canonicalised
  before comparison: octets outside ASCII percent-encoded, an existing
  `%xx` upper-cased, and nothing else touched — a pattern's `*` and `$`
  are §2.2.3's special characters and survive. Findings still quote the
  pattern the file spells, not the canonical form.

### Changed

- **Longest-match-wins is measured on the encoded pattern**, §2.2.2's
  "most octets", rather than on `pattern.length`. This changes answers:
  `/café` is ten octets encoded, so a five-unit `/ca*e` beside it no
  longer ties with it and no longer wins. The Rust CLI in `crate/` made
  the same change in the same commit — the shared `analyze_robots_txt`
  tool must answer identically from either server.

## [2.2.5] - 2026-08-14

### Fixed

- **The Help command's Open VSX rating link pointed at a namespace that
  does not exist.** It named `nolindnaidoo`; the extension is published
  under `OffensiveEdge`, so anyone following it from inside the editor
  got a 404 on the one page that asks them for a rating.

### Changed

- **New icon artwork.** All sixteen tools were redrawn in one style, so
  the family reads as one set wherever the listings sit side by side —
  the Marketplace, Open VSX and letools.dev. The framing is unchanged:
  the drawing fills 65.8% of an 800×800 canvas, and every smaller size
  is derived from that one file rather than drawn again.

- The README carries the family's pillars: an Install section naming
  every channel, and a Documentation table routing to SPEC.md, AGENTS.md
  and the changelogs. `## Development` restated AGENTS.md and is gone.

## [2.2.4] - 2026-08-07

### Changed

- Documentation only — no behaviour change.

  The cross-references now point at each tool's own page on letools.dev rather
  than its VS Code Marketplace listing. The Marketplace listing shows one of
  the four channels a tool ships through; the detail page shows all of them,
  which is what a reader following a link from another tool is looking for.
  Install instructions are untouched, and the rating links now lead with Open
  VSX — where the audience these READMEs reach actually installs from.

- `homepage` in the extension and MCP manifests, and `websiteUrl` in the
  registry entry, resolve to the same detail page.

## [2.2.3] - 2026-08-05

### Changed

- Documentation and packaging metadata only — no behaviour change.

  The MCP server's source now explains its decisions rather than restating its
  code: why MCP's stdio transport is line-delimited and what happens to a client
  if you copy LSP's framing, why a tool failure is a result carrying `isError`
  rather than a JSON-RPC error and what each does to a model's next move, why
  the result cap is measured in context windows rather than milliseconds, and
  why `truncated` matters more than the cap itself.

- The npm package declares `publishConfig.provenance`, so a release published
  from CI carries a Sigstore attestation binding the tarball to the commit and
  workflow that built it. A consumer can verify it with `npm audit signatures`.

- The registry entry names its registry (`registryBaseUrl`) and how to run the
  package (`runtimeHint`), rather than leaving a client to infer both.

- Package metadata points at the author's site, and the npm page links the rest
  of the family, the Rust tools and their crates.

## [2.2.2] - 2026-08-05

### Changed

- Documentation only — no behaviour change.

  The README described a keyboard shortcut and little else. 2.2.1 added an MCP
  server that VS Code registers with agent mode, published it to npm and to the
  official MCP registry, and submitted a Zed extension — and a reader could
  discover none of it from this page. There is now a section for calling the
  tool from an agent, including the JSON config for hosts that use one and a
  one-line check that the server answers before you wire it into anything.

  The privacy section previously spoke only for the extension. It covers the
  server too, which is the part an agent actually runs.

  The registry listing gains a display name, an icon and a link to letools.dev;
  the npm page gains the badges and links it was missing. Every surface now
  points at the others.

## [2.2.1] - 2026-08-05

### Changed

- **VS Code 1.101 is now the minimum.** `engines.vscode` moves from `^1.90.0`
  to `^1.101.0` and `@types/vscode` is pinned exactly to the new floor, per the
  rule that the declared floor and the type surface must match. 1.101 is the
  first stable release carrying `registerMcpServerDefinitionProvider`, which
  the MCP integration needs — declaring the contribution point against an older
  floor would be a claim the code could not honour. Cursor and VSCodium track
  well past this; Cursor 3.6.21 reports 1.105.1.

### Added

- An MCP server, shipped inside the VSIX as `dist/mcp-server.js`. It exposes
  `analyze_robots_txt` over stdio, so an agent can pull every rule out of a document
  with its 1-based position.

  It imports the extraction engine and nothing from `vscode` —
  `check:mcp-bundle` fails the build if that stops being true, because the
  server has to run in Zed, in Claude Code, and from `npx`.

- The extension now offers that server to VS Code's agent mode, so installing
  it adds `analyze_robots_txt` to the agent's tools alongside the existing commands.
  Nothing is downloaded at runtime: the server is the copy inside the VSIX.
  The registration is skipped on editors that do not implement the API, which
  is not an error — an editor without agent mode is not a broken install.

- The server is on npm as [`scrape-le-mcp`](https://www.npmjs.com/package/scrape-le-mcp),
  so `npx scrape-le-mcp` gives the same tool to Claude Code, Cursor, Windsurf or
  anything else that speaks MCP. It is the same build the VSIX carries, and its
  version is written from this manifest rather than maintained separately.

- A **Zed extension**, under `zed/`. Zed's extension API has no way to read the
  active buffer or register a command, so this extension could never be ported
  there in any language; a context server is the surface that fits. The crate
  is a launcher — it installs `scrape-le-mcp` and starts it with Zed's Node — so
  there is no second implementation to keep in agreement with the goldens.

  **This server makes no network request.** The extension's own
  `fetchRobotsTxt` builds its URL from an arbitrary origin, so inside an agent
  loop it would be an SSRF primitive — `http://169.254.169.254/robots.txt`
  resolves on a cloud host, and the caller supplying the URL is the model
  rather than the user. The agent already has HTTP tools the user approved; the
  server takes the content it fetched and does the analysis, which is the half
  that needs this extension's rules engine. A test asserts no tool accepts a
  `url` argument.

  `parseRobotsTxt` is newly exported for this. Its behaviour is unchanged —
  only its visibility.

  A path with no leading slash and no scheme is read as a path, not a host.
  Normalising `admin` into `https://admin` yields the pathname `/`, which
  matches no Disallow rule and reports the path as crawlable — and guessing
  wrong toward "you may crawl this" is the one direction that causes harm.

### Fixed

- The coverage gate could pass against a stale summary. `coverage-readme.js`
  reads `coverage/coverage-summary.json` rather than running coverage, so when
  that file was older than the code both modes lied — the rewrite reproduced
  stale numbers and `--check` then compared the README against the same stale
  file and reported it current. Both modes now refuse a summary older than
  `src/`.

- The manifest placeholder gate only inspected `contributes.commands`, so a
  `%key%` on any other contribution point could ship as literal text. It now
  walks the whole `contributes` tree.

## [2.1.0] - 2026-08-05

### Added

- `retry.userAgents` (off by default). When a check fails or trips bot
  detection, the URL is re-checked under a desktop Chrome, desktop Firefox and
  mobile Safari agent, and the report says which one loaded cleanly and what to
  set `browser.userAgent` to. A blocked check used to report only what
  resisted; this reports what would work.

  It stops at the first clean agent rather than surveying all three, skips an
  agent the user already configured, takes no screenshot on a retry, and treats
  a 4xx as a failure rather than a working configuration. Off by default
  because each retry is a full page load.

  This varies one header that every HTTP client exposes and reports what it
  observed. It does not patch the automation fingerprint or attempt to defeat a
  challenge — the extension exists to tell you the truth about a site's
  posture, including when the answer is that you cannot scrape it.

- Runtime strings are localized, and this time they render. All 11 of them —
  notifications, status bar, quick-picks and prompts — go through
  `vscode.l10n` and ship as twelve translated bundles in `l10n/`. The v1.x
  line carried manifest catalogues that worked and runtime catalogues that
  never reached the screen: `vscode-nls` was configured without
  `__filename`, so every runtime string fell back to English while the VSIX
  looked correct.
- An integration test covering both localization mechanisms — manifest
  substitution, key parity across all thirteen catalogues, and placeholder
  integrity in every translation. A translation that silently drops `{0}`
  now fails the build instead of shipping a message with the value missing.

- Dependency review on pull requests, failing on a high-severity addition
  before Dependabot's auto-merge can act.

### Fixed

- `browser.userAgent` did nothing. The setting was declared in the manifest,
  read by `config.ts` and threaded all the way into `CheckOptions`, but the
  page was created with only the viewport — so anyone who set a User-Agent got
  Chromium's headless default and no sign that their setting was ignored. It is
  applied at page creation now, with a test that drives both a configured agent
  and the default.

- Every detector turned an error into a confident negative. `detectAntiBot`,
  `detectAuthentication`, `detectRateLimit` and `fetchRobotsTxt` each caught
  any failure, wrote a `console.error` the user never sees, and returned a
  default "nothing found" result — so a check that crashed reported
  "Anti-Bot: Not detected" and "Authentication: Not required" exactly as a
  check that had run cleanly. The robots.txt case was the sharpest: a failed
  fetch returned `allowsCrawling: true`, commented in the test as the "safe
  default", which told the user crawling was permitted because the check had
  failed. Failures now propagate, are collected per detection, and are printed
  in the report.
- The browser launched with `--no-sandbox --disable-setuid-sandbox` on every
  run. The Chromium sandbox is the boundary between a hostile page and the
  user's machine, and this extension points a real browser at whatever URL it
  is given. The sandboxed configuration is now tried first, with the opt-out
  kept only as a fallback for environments (containers, hardened kernels) that
  genuinely cannot start it.
- The Chromium install prompt was never localized — the message, all five
  button labels and the three result notifications. The labels are now bound
  to constants and compared by reference: `showWarningMessage` returns the
  label that was clicked, so localizing them without binding would have made
  the install prompt impossible to accept outside English.
- The URL input validators and the five progress messages were never
  localized — validation text is returned from a callback and progress text
  goes through `progress.report()`, so neither was a property the
  localization pass inspected.

### Changed

- Every `else` block is gone (16 of them), replaced by guard clauses and value
  expressions. The anti-bot detector's three-arm chain now derives how the
  signature was found as a value, so the label and the flag can no longer
  disagree.

- Test coverage raised from 79.51% to 84.90% of branches (88.95% to 96.70% of
  statements, 85.71% to 98.09% of functions). Four files sat below one of the
  repo's own floors; none do now. `scraper/install.ts` was the least-covered
  at 41% statements: it is only reached when Chromium is missing, and every
  branch past that depends on which button the user clicks. The child process
  that performs the ~130MB download is stubbed, so the accept path is
  exercised without touching the network. The `page.evaluate` callbacks in the
  authentication detector — where the login-form and keyword heuristics
  actually live — run inside the browser and were never invoked by a stubbed
  page; they are now driven against a document stub.


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
