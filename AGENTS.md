# AGENTS.md — Scrape-LE

Technical source of truth for this repo. README.md is the user-facing doc; this file is for anyone (human or agent) changing the code.

This repo hosts **two products**: the extension at the root (this document's scope) and the Rust CLI in `crate/` (its own `AGENTS.md` + `SPEC.md`). The shared detection corpus lives at `signatures/` and `fixtures/`; `scripts/check-signature-parity.ts` fails CI when this extension drifts from it.

The Rust CLI also ships **a second way, through npm**: `src/cli/` is its terminal surface rebuilt over this extension's vendor table and robots.txt encoding, bundled to `cli/cli.js` as the npm package `scrape-le`. Both install a command named `scrape-le`, so the npm one is held to the crate's surface byte for byte, which is a different contract from the corpus parity above. `src/cli/` follows `crate/src/cli.rs`, `check_url.rs`, `fetch.rs`, `render.rs`, `batch.rs`, `detect/` and `mcp/`, not the extension's commands: it speaks HTTP/1.1 over a socket the way ureq does, launches Chrome with `headless_chrome`'s flags and drives it over `--remote-debugging-pipe`, and writes JSON the way serde_json does. `scripts/check-cli-parity.ts` runs both binaries against one loopback fixture server, rendered and not, and fails on any difference in stdout, stderr, exit code, screenshot name, or what `scrape-le mcp` answers. Only timings are masked, and the wording of a TOML or JSON parse error the crate's parsers render. `scripts/check-cli-pipes.ts`, shared with every port, closes stdout or stderr before either binary writes and fails on any difference in what follows, on all three operating systems. A change to the crate's surface changes `src/cli/` in the same commit.

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
cli/                     the npm command line: run (cli.rs), checkUrl, fetch + http +
                         httpUri (ureq and the http crate), render + browser
                         (headless_chrome over a pipe), batch, report (detect/check.rs),
                         robots, signatures + toml, mcp (the crate's server), json
                         (serde_json's output). No `vscode`, and no playwright-core
```

Conventions: factory functions + `Object.freeze` (no classes), guard clauses, dependency bags typed inline at the consumer — see **Code style** below. Both the manifest and the runtime strings are localized into 12 locales; see **Toolchain**.

## Code style

These are not preferences to weigh against convenience. They are the shape the
code is expected to take, and a review rejects work that ignores them. The
reason each one exists is stated, because a rule without a reason gets
cargo-culted into places it does not belong.

### Control flow

**Guard clauses first, then the work.** Every function opens with its
preconditions, each one returning immediately. The body that follows is the
happy path at a single indent level, and it reads top to bottom.

```ts
// Yes — preconditions leave, then the real work runs unindented.
function extract(document: TextDocument, config: Configuration): Result {
	if (!document) return EMPTY;
	if (!isSupported(document.languageId)) return unsupported(document.languageId);

	const text = document.getText();
	if (!text.trim()) return EMPTY;

	return runExtraction(text, config);
}
```

**No `else`. No `else if`.** An `else` is a guard clause that has not been
extracted yet. Two branches become an early return; many branches become a
lookup table or a `switch` that returns from every arm. This is the rule that
does the most work in practice — it is what keeps nesting flat, keeps diffs
small, and stops a function growing a second responsibility inside its own
`else`.

```ts
// No.
if (kind === 'hex') {
	return parseHex(value);
} else if (kind === 'rgb') {
	return parseRgb(value);
} else {
	return null;
}

// Yes — a table. Adding a format touches one line and no control flow.
const PARSERS: Readonly<Record<ColorKind, Parser>> = Object.freeze({
	hex: parseHex,
	rgb: parseRgb,
	hsl: parseHsl,
});

function parse(kind: ColorKind, value: string): Color | null {
	const parser = PARSERS[kind];
	if (!parser) return null;
	return parser(value);
}
```

**Maximum nesting is two levels inside a function.** A third level means the
inner block wants to be its own named function. Loops containing conditionals
containing conditionals are where bugs hide, because no reader holds all three
conditions at once.

**Truthy checks.** `if (!value)` rather than
`if (value === undefined || value === null || value === '')`. The exception is
real and must be respected: when `0`, `''` or `false` are legitimate values,
test explicitly (`value === undefined`, `Number.isFinite(value)`). A threshold
of `0`, an empty string that means "cleared", and `false` from `applyEdit` have
all been live bugs in this family — the terse form is the default, not a
licence to ignore the domain.

### Errors

**Every error path is handled and says something true.** A message names what
failed, why, and what state the user is now in. "Extraction failed" is not a
message; "Could not replace the document contents: the edit was rejected" is.

**Never swallow.** No empty `catch`, no `catch { return null }` that erases a
cause the caller needed, no `|| true`, no `continue-on-error`. If a failure is
genuinely ignorable, the `catch` says why in a comment.

**Failures are values where the caller must react.** A parse failure that the
user should see is reported through the callback or return value the caller
supplied — not thrown past it, and never turned into a silent empty result.
Reserve `throw` for programmer error and for unwinding to a command's outer
handler, which is the one place that decides what the user sees.

**Never report success you did not achieve.** Check what the API returned.
`vscode.workspace.applyEdit` resolves `false` for a read-only document; a
cancelled operation delivers nothing. Announcing a count over work that never
happened is the single most repeated defect in this family's history.

### Data

**Immutable by default.** `readonly` on every interface field, `ReadonlyArray`
on every collection you do not own, `Object.freeze` on returned config and
result objects. Never mutate a parameter. Build a new value and return it.
Where a mutable working copy is genuinely needed, derive the mutable type
(`type Draft<T> = { -readonly [K in keyof T]: T[K] }`) rather than
hand-maintaining a second parallel interface that drifts.

**Composition over inheritance.** Factory functions returning frozen objects,
not classes and not `extends`. Dependencies arrive as a parameter — a typed
deps bag — so a test supplies a fake without a framework. There is no
inheritance hierarchy anywhere in this fleet and there should never be one.

```ts
export function createNotifier(deps: Readonly<{ config: Configuration }>): Notifier {
	return Object.freeze({
		showInfo: (message: string) => { /* ... */ },
		showError: (message: string) => { /* ... */ },
	});
}
```

### Structure

**Logic and presentation are separate, always.** Extraction, analysis and
conversion modules compute and return data. They never call
`vscode.window.*`, never format a user-facing sentence, never decide whether a
notification is shown. `ui/` renders; `commands/` orchestrates. The test for
whether you got this right: a logic module should be unit-testable without the
`vscode` mock at all.

**Where a UI framework is involved, the same rule applies to the render.**
Compute above, return markup below. A render body holds no conditionals beyond
a trivial ternary, no data shaping, no derivation — those are named values or
functions above it. Anything else produces JSX no one can read, and it hides
the logic from the tests.

**Commands are thin.** A command reads config, calls logic, hands the result to
the UI layer, and handles failure. When a command file grows a parser or a
formatter, that code belongs in `extraction/` or `ui/`.

**No god files.** Past ~300 lines, a file is doing more than one job and wants
splitting along the seam that is already visible in its exports. `types.ts`
holds types only — no logic, ever.

**Separation of concerns, without ceremony.** One module per real concept, not
one per function. A `utils/` folder of single-line files is as unmaintainable
as a god file; both make you read the whole tree to understand one path.

**Define it once.** Duplicate regexes, duplicate `fullDocumentRange`,
duplicate "is this a supported scheme" checks — each has already shipped as a
bug in this family, because copies drift and only one copy gets fixed. When you
find yourself writing something that exists elsewhere, move it to a shared
module in the same commit.

### Comments

Comments explain **why**, never what. A comment restating the code is noise
that goes stale. A comment recording the reason a non-obvious choice was made —
the constraint, the bug it prevents, the API quirk it works around — is the
most valuable line in the file, and it is what keeps the next person from
"simplifying" it back into a defect.

---

## Invariants (things that were once broken — keep them true)

- **The bundle must be self-contained except playwright-core.** v1.x shipped tsc output requiring `node_modules` that the VSIX excluded — no published version could activate. `scripts/check-bundle.js` (run in `vscode:prepublish` and CI) does a static require scan, loads the bundle with `vscode` stubbed, and verifies `.vscodeignore` allow-lists `node_modules/playwright-core/`. playwright-core cannot be bundled (optional chromium-bidi requires, `require.resolve` asset paths) and ships whole in the VSIX.
- **The rating prompt is asked at most twice per user, and only after a run that delivered its result.** `rating/policy.ts` holds the thresholds (the 3rd use, then once more 17 uses on, which is the 20th) and has no `vscode` import; `ui/ratingPrompt.ts` shows it. Both files, and their tests, are byte-identical across the family — change one repo and copy to the rest. The ask is written to `globalState` *before* the toast is awaited, because a window closed with the toast up never resolves it and an ask counted only on an answer would reappear on every launch. It bypasses the notifier on purpose: where `notificationsLevel` defaults to a quiet level, the effective level would silence it for everyone. What it honours instead is a level the user set themselves — any explicit value other than `all` means never ask. **Rate opens the registry this copy was installed from**, read off the host in `vscode.env.appName`: VSCodium, Cursor and Windsurf install from Open VSX, VS Code from the Marketplace, both under publisher `nolindnaidoo`. Any other publisher in `context.extension.id` (a fork, a local package) has no listing and is never asked. The table once keyed Open VSX on a publisher `OffensiveEdge` that no listing carries, so every Rate click opened the Marketplace page; `ratingPrompt.test.ts` drives each host. Never hook it to activation, and never to a path that can fail.
- **`DEFAULT_CONFIG` must equal package.json defaults.** `config.test.ts` asserts parity over every declared setting; add new settings to both plus the KEY_MAP in the test.
- **Every declared setting must have a consumer.** v1.x declared screenshot format/quality and then ignored them; don't add a setting without wiring it.
- **Detector behavior is pinned by golden snapshots** (`detectors/characterization.test.ts` + `__fixtures__/`). Any output change must update goldens in the same commit and be listed in the CHANGELOG.
- **Anti-bot signatures live in one place** (`detectors/heuristics.ts`), probed with a single `page.evaluate`. Never re-implement a per-vendor scan inside a detector, and never add ambiguous markers (bare `[data-sitekey]`, plain `gstatic.com`) that fingerprint more than one vendor.
- **Deactivation leaves nothing alive, and repeated runs do not grow.** `src/lifecycle.test.ts` activates against the mock, runs every command, disposes every subscription and reads `_live()` back as zeros with no timer pending; then runs every command fifty times and reads the same counts as after one. The mock counts what it created and has not released: status bar items, output channels, configuration listeners, commands and MCP providers, with `_setLmApi(false)` for a host without agent mode. The first run found the status bar's reset timer surviving deactivation, because activation held the bare item rather than the wrapper that owns the timer.
- **Every runtime string is in the bundle, and the bundle holds nothing else.** `src/l10n.test.ts` reads every `l10n.t()` call in `src/`, holds its string to `l10n/bundle.l10n.json` and the twelve locales, refuses a call at module scope or with anything but a literal, and refuses a literal handed straight to a notification, the status bar, a prompt or a dialog button. Thirteen strings were shown in English in every language before it existed; a string the host cannot find falls back silently, so nothing else would have said so.
- **nls catalogues stay in key-parity:** all 12 locale files carry exactly the keys of `package.nls.json` and the manifest uses exactly those keys (`src/i18n/nls-parity.test.ts`).
- **No test touches the network.** robots.txt tests stub `fetch`; command tests mock the scraper modules; browser install is never executed by tests.
- **Errors shown to users pass through `sanitizeErrorMessage`** (home directories, credential-shaped fragments).

- **The MCP server must never reference `vscode`.** It runs in Claude Code and from `npx`, where the import would fail in a user's session rather than in CI. `scripts/check-mcp-bundle.js` fails the build on any non-builtin require, holds the bundle under a 600 KB ceiling, and completes a real stdio handshake asserting extracted values — the SDK was rejected at 5.9 MB and without a ceiling that decision quietly rots.
- **Launching the server needs `ELECTRON_RUN_AS_NODE=1`.** In the extension host `process.execPath` is the editor binary, so without it the definition starts a second editor and fails silently. `scripts/e2e-vsix.js` spawns the installed server exactly as `provider.ts` does and asserts it answers.
- **Manifest placeholders are checked across every contribution point**, not just command titles. A `%key%` with no catalogue entry reaches the user as literal text; the gate in `test/integration/l10n.test.ts` walks the whole `contributes` tree.
- **The MCP input buffer is bounded** at `MAX_FRAME_BYTES` in `mcp/transport.ts`. A frame past it is answered with a parse error and the rest of that line is dropped as it arrives, whether its newline comes late or in the same chunk. `mcp.test.ts` feeds a frame one byte over the limit and a ping after it, both ways. The npm command line's server reads frames through `src/cli/frames.ts`, which carries the same limit; both files are the newer copy a few repos in the family hold, listed as such in `letools-site`'s `check:fleet`.
- **A probe that cannot run fails its detection; it never reads as clean.** `detectors/antibot.ts` and `detectors/authentication.ts` carry no `catch`: a header set that cannot be read, a page evaluate that throws or a URL that cannot be parsed propagates to `runDetections`, which records it in `failures`, and the report prints the check as failed. Each used to swallow its failure into an empty result and print "None detected" or "Not required" for a signal it never looked at. The tests titled "cannot run" in `antibot.test.ts` and `authentication.test.ts` hold the rejection.
- **An unreachable robots.txt is a complete disallow; an absent one is not.** RFC 9309 §2.3.1.3 against §2.3.1.4, the line the crate draws in `fetch.rs`: a 4xx is no rules and crawling allowed, while a 5xx, a timeout or a network failure means the rules exist and could not be read, so `fetchRobotsTxt` answers `allowsCrawling: false` with `exists: false` and the reason in `unreachable`, quoting no rule because none was served. Both used to read "Not found, crawling allowed". `robotstxt.test.ts` holds the 403, the 503 and the failed fetch, and the characterization goldens pin the shape.
- **The status bar owns its idle reset.** `resetAfter(ms)` is the only timer that touches the item: a later `show()` or `resetAfter()` cancels the pending one and `dispose()` clears it, so a check started inside another's cooldown is never reset under it and nothing fires after deactivation. The timer used to sit untracked in the check command. `statusBar.test.ts` ("the idle reset") holds the cancel and the dispose, and `check.test.ts` drives two checks at once with a hand-resolved checker.
- **The output channel is released by activation, not by whoever made it.** `ui/output.ts` creates its channel on first use, so nothing registered up front held it and deactivation left it live; `registerOutput(context)` pushes the release whether or not a channel is ever created, and `disposeOutput()` also forgets it so the next log starts a fresh one. The same module state outlived each unit test: with only the mock's list cleared, every test after the first found no channel, and the suite passed in file order and failed shuffled. A test that reads the channel its own run created calls `disposeOutput()` in `beforeEach`. `output.test.ts` ("output channel lifetime") holds the release and the repeat.
- **The three MCP servers refuse a malformed frame in one set of words.** The extension's server (`mcp/transport.ts`), the npm command line's (`cli/mcp.ts` over `cli/frames.ts`) and the crate's (`crate/src/mcp/mod.rs`) answer the same frame the same way: `Invalid JSON`, `Not a JSON-RPC 2.0 request` and the frame-limit refusal as `-32700` with a null id; a null id as a notification; `initialize` with this server's own protocol version and `{ tools: {} }`; `Unknown method: …`, `Unknown tool: …` and ``tools/call requires a string `name` `` for the rest. They shipped three behaviours, and a client could tell them apart by what it sent. `mcp.test.ts` and `cli.test.ts` each hold the words ("refuses … in the words the other two servers use"), the crate holds them in `protocol_refusals_use_the_npm_servers_words`, and `check:cli-pipes` feeds both binaries the malformed frames and compares the replies.
- **Every command body runs inside `commands/guard.ts`.** A rejection that escapes a command is reported by the editor in its own words, raw message and home directory included; through the guard it is one redacted, localized error after the command's own `finally` has run. `guard.test.ts` reads the source and fails on a `registerCommand` whose handler is not `guarded(...)`.

## Toolchain

- **Runtime targets:** `engines.vscode` is the supported floor and `@types/vscode` is pinned to it **exactly**. A caret there lets the type surface drift ahead of the version users actually run, so code compiles against APIs that are not there at runtime. Dependabot is configured to never bump it.
- **Build:** esbuild bundle (`bun run build`, `build:prod` minified). `tsc` is typecheck-only (`noEmit`) and covers test files. TypeScript 7.
- **Unit tests:** vitest 4; `vscode` aliased to `src/__mocks__/vscode.ts` (stateful mock with `_reset/_set` helpers). Coverage provider `istanbul`, thresholds enforced at **70 lines / 70 functions / 60 branches / 70 statements**. These are a backstop against a module nobody tested, not a target — they sit well below where the code actually is, and they are not raised to track it. Lower them only with a reason; do not raise them to chase a number.
- **Integration tests:** `bun run test:integration` — `@vscode/test-cli` launches a real VS Code (config in `.vscode-test.mjs`, tests compiled via `tsconfig.it.json` to `out-test/`). That project targets `node16` module resolution; TypeScript 7 removed `node10`, which `"Node"` resolved to.
- **Installed-VSIX tests:** `bun run test:e2e-vsix` installs the built `.vsix` into a clean VS Code profile and drives it. This is the only test that exercises the artifact users receive, and it runs in CI.
- **Lint/format:** Biome (tabs, single quotes). `__fixtures__`/`__snapshots__` are exempt — formatting fixtures would corrupt goldens. `biome.json` is one of the files `letools-site/scripts/check-fleet.ts` holds byte-identical across all ten repos; change it in one, copy it to the rest, and let `bun run check:fleet ../` say whether a copy was missed.
- **Packaging:** `bun run package` → `release/*.vsix`. `.vscodeignore` is an allow-list; the VSIX is 78 files, most of them `playwright-core` — this is the one extension that ships a runtime dependency, so it packages **with** the npm tree while the other nine use `--no-dependencies`.
- **Localization:** two separate mechanisms. The 12 `package.nls.*.json` catalogues in `src/i18n/` localize **manifest** strings (VS Code `%key%` substitution) and are copied to the package root at prepublish, then removed by `clean:i18n`. The 12 `l10n/bundle.l10n.*.json` catalogues localize **runtime** strings via `vscode.l10n.t()`, enabled by `"l10n": "./l10n"` in package.json. They fail independently: a working manifest says nothing about the runtime bundles. The rules that keep both correct are under **Code style** above.

- **npm command line:** `bun run build:cli` bundles `src/cli/main.ts` to `cli/cli.js` and writes `cli/package.json`'s version from the root manifest. It has no runtime dependency, so `npx scrape-le` fetches one tarball. `bun run check:cli-parity` needs that and a `cargo build` of the crate, and is what the `cli-parity` job in `ci-crate.yml` runs, with `bun run check:cli-pipes` after it on all three OSes, with a browser required (`SCRAPE_LE_PARITY_RENDER=1`). `bun run check:cli-package` packs `cli/`, installs the tarball into a throwaway project and runs the installed `scrape-le` against a loopback page and through `scrape-le mcp`. It publishes from its own workflow, `release-cli.yml`, because `release.yml` is fleet-shared.

- **npm package:** `bun run build:npm` assembles `mcp/` and writes its version from the root manifest, so the two can never claim the same version while carrying different code. `bun run check:npm-package` packs it, installs the tarball into a throwaway project and drives the *installed* binary through a handshake — which is what `npx` does, minus the registry. Run it before publishing: a version cannot be reused, and the unpublish window is 72 hours.

## Generated documentation

Two README sections are generated. Do not hand-edit the content between their markers.

- `bun run test:coverage && bun run coverage:readme` writes the Testing section from `coverage/coverage-summary.json`. It is regenerated at release, which is step 2 under **Release**. CI does not check it: the check failed a build whenever a test was added or coverage moved by a point, on changes that had nothing wrong with them. `bun run coverage:readme:check` is still there to run by hand, and compares coverage within 1 percentage point and test counts exactly.
- `bun run benchmark && bun run perf:readme` writes the Performance section from a real run of the extraction entry point. This is **not** checked in CI: throughput is machine-specific, so a hosted runner would fail it for reasons that say nothing about the code. The host is printed with the numbers instead.

The pre-2.0 README carried hand-written test counts and throughput figures that drifted until they were false. Generating them is what stops that recurring.

## Security & automation

- **CodeQL** runs on push, PR and weekly (`javascript-typescript` + `actions`), configured in `.github/codeql-config.yml`. Test files and fixtures are excluded on purpose: they contain inputs that are supposed to look dangerous, and scanning them produces findings that can only ever be dismissed.
- **Dependabot** opens security updates only. Every ecosystem in `.github/dependabot.yml` sets `open-pull-requests-limit: 0`, which turns version updates off and leaves the alert-driven security PRs on. Versions move by hand, the Rust toolchain pin in `crate/rust-toolchain.toml` included. The ecosystem is `bun`, not `npm`: the npm updater rewrites `package.json` without regenerating `bun.lock`, so its PRs can never pass the frozen-lockfile gate. `cargo` covers `crate/`.
- **Auto-merge** is workflow-driven, not GitHub-native: `main` has no required status checks, so native auto-merge would land a PR before CI started. `dependabot-auto-merge.yml` waits for every other check on the head commit to pass, then merges any update but a major, runtime dependencies included: a merge publishes nothing, and the VSIX only ships from a manual release. Majors need a human. After a merge it dispatches CI on `main`, because a merge made with `GITHUB_TOKEN` starts no push run and each PR was only tested against its own base. The workflow is byte-identical across all sixteen tool repos.
- **Actions are pinned to commit SHAs.** A tag is mutable and this repo holds a publish token. The trailing `# vX.Y.Z` comment is what Dependabot reads and rewrites.
- **Branch safety:** a `main-safety` ruleset blocks deletion and force-push. Pushes to `main` are otherwise unrestricted by design.
- Secret scanning and push protection are enabled. `VSCE_PAT` and `OVSX_PAT` live in repo secrets and in Doppler (`extensions` / `prd`).

## Agent and editor instructions

Every major coding assistant looks for its own instruction file, so each one is
present and each is a thin pointer to this document:

| File | Tool |
|---|---|
| `AGENTS.md` | the standard itself — OpenAI Codex and others read this directly |
| `CLAUDE.md` | Claude Code |
| `GEMINI.md` | Gemini CLI |
| `.cursorrules`, `.cursor/rules/project.mdc` | Cursor (legacy and current formats) |
| `.windsurfrules` | Windsurf |
| `.clinerules` | Cline |
| `.github/copilot-instructions.md` | GitHub Copilot |

**Keep them thin.** They restate the non-negotiables and route the reader here;
they must never grow a second copy of the standard, because a copy drifts and
then two tools disagree about the same repository. Change the standard here,
and only the pointer's short list if a non-negotiable itself changed.

None of them ship: `.vscodeignore` is an allow-list, so the VSIX is unaffected.

## Git identity

Every commit uses the GitHub noreply address:

```
13629544+nolindnaidoo@users.noreply.github.com
```

A real address in commit metadata is public forever — GitHub's API serves it
for any public repo, and scrapers harvest it. Never set a real address in
`user.email`, globally or repo-locally, and never commit with one. GitHub's
*Block command line pushes that expose my email* is the backstop; the global
config is the default. A repo-local `user.email` silently overrides the global
one, so check `git config user.email` in a fresh clone before the first commit.

## Commits

Subjects use a conventional prefix — `feat:`, `fix:`, `docs:`, `test:`, `ci:`,
`build:`, `chore:`, `refactor:`, `perf:`, `revert:` — an optional `(scope)`,
and an imperative summary with no trailing period. The body says why the
change was needed and what it prevents; a subject alone is rarely enough to
reconstruct a decision six months later.

This is enforced, not just documented:

- **`commit-msg` hook** — `bun run hooks:install` points `core.hooksPath` at
  `.githooks/`, and `prepare` runs it on install, so a fresh clone is wired
  after `bun install`. It rejects the message before the commit exists.
- **CI** — the `Commit messages` job runs the same validator over the pushed
  range. The hook is skippable with `--no-verify`; this is not, so skipping it
  delays the failure rather than avoiding it.

Both call one implementation, `scripts/commit-lint.js`, so the rules cannot
drift apart. Check a branch yourself with `bun run lint:commits`. Merge commits
are exempt — git writes those subjects, not a person. Only the commits in a
push are checked, so history predating the gate is left alone.

## Release

**Three files carry the extension version, and CI fails unless all three agree.**
`package.json`, `mcp/package.json` and `server.json` (**both** `.version` and
`.packages[0].version`). The same CI step pins registry identity:
`server.json.name` must equal `mcp/package.json.mcpName`, and
`server.json.packages[0].identifier` must equal `mcp/package.json.name`.

**This gate is not relaxable.** The MCP registry verifies ownership by reading
`mcpName` out of the *published* npm package, so a mismatch is only discoverable
after the version is spent — and a version can never be republished. That is why
this is a gate rather than a convention.

**Every surface carries one version, since 2.5.0.** The crate and the npm
command line join the three files above: `crate/Cargo.toml` (and its entry in
`crate/Cargo.lock`) and `cli/package.json` must equal `package.json`, which
the `versions` job in `ci-crate.yml` enforces. It used to be otherwise, with
the crate at 0.x on its own cadence and its own `crate-v*` tags, and that
stopped making sense once two binaries named `scrape-le` could print different
versions for the same behaviour. A release ships every surface, including one
that did not change, because skipping one is how the numbers drift apart again.

1. Bump `version` in package.json, mcp/package.json, server.json (both fields), cli/package.json and crate/Cargo.toml, and run `cargo build` in `crate/` to update the lockfile. Write the entry in CHANGELOG.md and in crate/CHANGELOG.md. The entry must describe what actually changed, including bug fixes — it ships inside the VSIX and renders on the listing page.
2. Regenerate the README sections (`coverage:readme`, and `perf:readme` if behaviour changed) and commit them.
3. CI green on all three OSes. That includes lint, typecheck, coverage, the bundle gate, packaging, integration tests, the installed-VSIX e2e, and in `ci-crate.yml` the crate, the parity checks and the version gate.
4. Tag the commit being released `v<version>`, so the tag is the artifact rather than an approximation of it. One tag covers every surface. Crate releases before 2.5.0 carried a separate `crate-v*` tag.
5. Dispatch the release workflows from the tag, one registry per authorization: `Release` for the VSIX registries and the MCP server, `Release (crate)` for crates.io, and `Release (npm CLI)` for `scrape-le` on npm. The last two dry-run unless their `publish` input is set. `Release` takes two independent opt-ins — `marketplace` (default **on**) and `openvsx` (default **off**) — because a version cannot be republished, so a run that publishes one registry and fails on the other is only recoverable by re-running with the failed target alone. It validates credentials before doing anything irreversible.

**Open VSX defaults off deliberately.** `ovsx publish` takes no namespace argument; it derives the namespace from `publisher` in the VSIX. Enabling it publishes to whatever `package.json` currently names, with no confirmation.

**The npm package ships from the same release**, as a third opt-in on the `Release` workflow. It publishes with the **`NPM_TOKEN`** repository secret, the same token every package in the family uses, kept in Doppler under `extensions` / `prd`. It expires and has to be replaced in both places when it does. Trusted publishing was written into this workflow and never set up on npm, so that step failed every time it ran until it was changed to the token.

## Known limitations (documented, not bugs)

- `scraper/install.ts` prompts the user directly (`vscode.window.show*`), which
  the fleet standard otherwise reserves for `ui/` and `commands/`. The browser
  install is an interactive flow — offer, consent, progress, manual fallback —
  so the module is effectively the adapter for it. Recorded as an exception
  rather than split, because routing six prompts through a port would add
  indirection without changing what the user sees.

- Anti-bot signatures are best-effort fingerprints of public
  integration patterns; vendors change them, and first-party proxied
  setups can evade them. Detection means "can challenge you", not
  "will"; absence is not permission to scrape.
- Detections run after `load` + a ≤5s network-idle settle; content
  rendered later can be missed by page-level probes.
- The in-page probe (`pageProbeScan`) executes in the browser; unit
  tests cover it with stubbed DOM globals, not a real DOM.
- Screenshot filenames embed hostname + date, so same-day re-checks of
  a URL overwrite the previous screenshot.
