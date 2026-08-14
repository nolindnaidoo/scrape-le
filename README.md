<p align="center">
  <img src="src/assets/images/icon.png" alt="Scrape-LE Logo" width="96" height="96"/>
</p>
<h1 align="center">Scrape-LE: Zero Hassle Scrapeability Checks</h1>
<p align="center">
  <b>Load a URL in headless Chromium and see what will block your scraper — before you write it</b><br/>
  <i>Anti-bot vendors, rate limits, robots.txt rules, login walls, console errors, screenshots</i>
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=nolindnaidoo.scrape-le">
    <img src="https://img.shields.io/badge/Install%20from-VS%20Code-blue?style=for-the-badge&logo=visualstudiocode" alt="Install from VS Code Marketplace" />
  </a>
  <a href="https://open-vsx.org/extension/OffensiveEdge/scrape-le">
    <img src="https://img.shields.io/open-vsx/dt/OffensiveEdge/scrape-le?style=for-the-badge&label=Open%20VSX&color=blue" alt="Open VSX downloads" />
  </a>
  <a href="https://www.npmjs.com/package/scrape-le-mcp">
    <img src="https://img.shields.io/npm/v/scrape-le-mcp?style=for-the-badge&label=MCP%20server&color=blue&logo=npm" alt="scrape-le-mcp on npm" />
  </a>
  <a href="https://crates.io/crates/scrape-le">
    <img src="https://img.shields.io/crates/v/scrape-le?style=for-the-badge&label=Rust%20CLI&color=blue&logo=rust" alt="scrape-le on crates.io" />
  </a>
  <a href="https://letools.dev/tools/scrape-le">
    <img src="https://img.shields.io/badge/LE%20Tools-letools.dev-blue?style=for-the-badge" alt="LE Tools" />
  </a>
</p>

---

<p align="center">
  <img src="src/assets/images/demo.gif" alt="Scrapeability Check Demo" style="max-width: 100%; height: auto;" />
</p>

> **Useful?** A star or rating is how other developers find it —
> [★ GitHub](https://github.com/nolindnaidoo/scrape-le) ·
> [★ Open VSX](https://open-vsx.org/extension/OffensiveEdge/scrape-le/reviews) ·
> [★ Marketplace](https://marketplace.visualstudio.com/items?itemName=nolindnaidoo.scrape-le&ssr=false#review-details)

## What it does

Run `Scrape-LE: Check URL Scrapeability` (`Ctrl+Alt+S` / `Cmd+Alt+S`), enter a URL, and the page loads in a real headless Chromium. The report lands in the output channel: HTTP status, page title, load time, console errors, a full-page screenshot, and four detections. Works in VS Code and VS Code–based editors like Cursor and VSCodium (installable from Open VSX).

One-time setup: run `Scrape-LE: Setup Browser` to install Chromium (~130MB, into Playwright's browser cache).

## Install

| Where | What you get | Install |
|---|---|---|
| **VS Code** | The same check, in your editor, on a keystroke | [Marketplace](https://marketplace.visualstudio.com/items?itemName=nolindnaidoo.scrape-le) |
| **Cursor, VSCodium, Windsurf** | The same extension | [Open VSX](https://open-vsx.org/extension/OffensiveEdge/scrape-le) |
| **A terminal or a CI step** | The same run over a whole tree, with exit codes | `cargo install scrape-le` · [crates.io](https://crates.io/crates/scrape-le) |
| **Any MCP agent, via Node** | `analyze_robots_txt` over stdio | `npx scrape-le-mcp` · [npm](https://www.npmjs.com/package/scrape-le-mcp) |
| **Zed** | The MCP server as a context server | [add it by hand](https://zed.dev/docs/ai/mcp) *(no listing yet)* |

## Use it from an AI agent

The same engine runs as an [MCP](https://modelcontextprotocol.io) server, so an agent can call it directly instead of you running a command.

| Editor | How |
|---|---|
| **VS Code** 1.101+ | Nothing to install — the extension registers `analyze_robots_txt` with agent mode |
| **Zed** | No listing yet — [add the MCP server by hand](https://zed.dev/docs/ai/mcp) |
| **Claude Code** | `claude mcp add scrape-le -- npx -y scrape-le-mcp` |
| **Cursor, Windsurf, anything else** | point it at `npx scrape-le-mcp` |

```
analyze_robots_txt(content, path, maxResults?)
```

Given robots.txt contents and a path, reports whether the generic (`User-agent: *`) rules permit crawling it, plus the crawl delay, disallowed patterns and any sitemaps.

The server takes content and returns data — it reads no files and makes no network requests of its own. Published as [`scrape-le-mcp`](https://www.npmjs.com/package/scrape-le-mcp) on npm and as `io.github.nolindnaidoo/scrape-le` in the [MCP registry](https://registry.modelcontextprotocol.io).

<details>
<summary><b>Configuring it by hand</b> — any host with an MCP config file</summary>

Most hosts read a JSON config. Add one entry:

```json
{
  "mcpServers": {
    "scrape-le": {
      "command": "npx",
      "args": ["-y", "scrape-le-mcp"]
    }
  }
}
```

`-y` skips the install prompt on first run. Pin a version if you would rather not track releases — `scrape-le-mcp@2.2.5`.

Prefer not to go through `npx` on every launch? Install it once and point at the binary instead:

```bash
npm install -g scrape-le-mcp
```

```json
{
  "mcpServers": {
    "scrape-le": { "command": "scrape-le-mcp" }
  }
}
```

It speaks MCP over stdio and needs no environment variables, no API key and no configuration of its own. To check it before wiring it into anything:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | npx -y scrape-le-mcp
```

That prints the tool list and exits — if you see `analyze_robots_txt`, the server works.

</details>

## The CLI

The same check runs from a terminal or an agent loop: a Rust CLI in [`crate/`](crate/) of this repository, sharing one signature corpus with the extension — [`crate/signatures/`](crate/signatures/) and [`crate/fixtures/`](crate/fixtures/) — so CI fails if the two ever disagree about a URL.

```bash
scrape-le https://example.com/search   # JSON on stdout, summary on stderr
scrape-le --input urls.txt             # a batch, streamed as it completes
scrape-le mcp                          # the same check over MCP on stdio
```

The exit code is the answer: **0 clear · 1 a real no · 2 the question was malformed.** ## Detections

| Detection | How it works |
|---|---|
| Anti-bot vendors | Response headers, script sources, DOM elements, and window globals fingerprint Cloudflare (incl. Turnstile challenges), reCAPTCHA, hCaptcha, DataDome, and PerimeterX |
| Rate limiting | `X-RateLimit-*` / `RateLimit-*` / `Retry-After` response headers, plus HTTP 429 |
| robots.txt | Fetches `<origin>/robots.txt` and evaluates the `User-agent: *` rules against your URL with RFC 9309 semantics — grouped agents, `Allow`/`Disallow` longest-match, `*` wildcards, `$` anchors, crawl-delay, sitemaps |
| Authentication | HTTP 401/403, login forms (password + username fields), auth keywords in page text, auth path segments in the final URL |

Honest limitations: signatures are best-effort fingerprints of public integration patterns — a detected widget means the page *can* challenge you, not that it will, and a clean result is not proof a site allows scraping. Agent-specific robots.txt groups are ignored (only the `*` rules are reported). Pages get up to 5 seconds to go network-idle after load, so content rendered later than that can be missed by the page-level detections.

## Commands

| Command | Description |
|---|---|
| `Scrape-LE: Check URL Scrapeability` (`Ctrl+Alt+S` / `Cmd+Alt+S`) | Prompt for a URL and run the full check |
| `Scrape-LE: Check Selected URL` | Run the check on the URL in the current selection (also in the right-click menu) |
| `Scrape-LE: Setup Browser` | Install or verify the Chromium browser |
| `Scrape-LE: Open Settings` | Open Scrape-LE settings |
| `Scrape-LE: Help & Troubleshooting` | Built-in documentation |

## Settings

| Setting | Default | Description |
|---|---|---|
| `scrape-le.browser.timeout` | `30000` | Page-load timeout in ms (5000–120000) |
| `scrape-le.browser.viewport.width` | `1280` | Viewport width |
| `scrape-le.browser.viewport.height` | `720` | Viewport height |
| `scrape-le.browser.userAgent` | `""` | Custom User-Agent (empty = Chromium default) |
| `scrape-le.retry.userAgents` | `false` | On a blocked or failed check, retry under common User-Agents and report which worked |
| `scrape-le.screenshot.enabled` | `true` | Save a full-page screenshot per check |
| `scrape-le.screenshot.path` | `.vscode/scrape-le` | Screenshot directory (workspace-relative or absolute) |
| `scrape-le.screenshot.format` | `png` | `png` or `jpeg` |
| `scrape-le.screenshot.quality` | `90` | JPEG quality 0–100 (ignored for png) |
| `scrape-le.checkConsoleErrors` | `true` | Capture console and page errors while loading |
| `scrape-le.detections.antiBot` | `true` | Anti-bot vendor detection |
| `scrape-le.detections.rateLimit` | `true` | Rate-limit detection |
| `scrape-le.detections.robotsTxt` | `true` | robots.txt fetch + evaluation |
| `scrape-le.detections.authentication` | `true` | Authentication-wall detection |
| `scrape-le.notificationsLevel` | `important` | `all` = every notification, `important` = warnings + errors, `silent` = errors only |
| `scrape-le.statusBar.enabled` | `true` | Show the status bar item |

## Languages

Twelve languages besides English:

German · Spanish · French · Indonesian · Italian · Japanese · Korean ·
Portuguese (Brazil) · Russian · Ukrainian · Vietnamese · Chinese (Simplified)

Both halves are covered — the manifest (command titles, setting names and
descriptions) and everything shown while the extension runs (notifications,
the status bar, quick-picks and prompts). The extension follows VS Code's
display language, so it matches whatever the editor is already set to; no
setting of its own.

## Privacy & security

- **Network access is the feature, and it is scoped.** A check talks to exactly two things: the URL you enter (loaded in headless Chromium, which fetches that page's own resources like any browser) and that origin's `/robots.txt`. Nothing is sent anywhere else — no telemetry, no analytics.
- **Screenshots stay local**, written to the configured path inside your workspace.
- **The MCP server makes no network request at all** — unlike the extension, deliberately. `fetchRobotsTxt` builds a URL from an arbitrary origin, which inside an agent loop is an SSRF primitive: the caller supplying the URL is the model, not you. The server analyses robots.txt content you already fetched, and a test asserts no tool accepts a `url` argument.
- Error notifications redact home directories and credential-shaped fragments.
- Respect the sites you check: a scrapeability report is information, not permission.

## Documentation

| What | Where |
|---|---|
| What the tool is allowed to say — scope, output contract, refusals, non-goals | [`crate/SPEC.md`](crate/SPEC.md) |
| How the extension is built and held together — architecture, invariants, toolchain, release | [AGENTS.md](AGENTS.md) |
| How the CLI is built and held together | [`crate/AGENTS.md`](crate/AGENTS.md) |
| What changed | [CHANGELOG.md](CHANGELOG.md) · [`crate/CHANGELOG.md`](crate/CHANGELOG.md) |
| The tool's page, and the other fifteen | [letools.dev/tools/scrape-le](https://letools.dev/tools/scrape-le) |

## Performance

<!-- performance:start -->
| Input | Size | Found | Time | Rate | Scan speed |
| --- | --- | --- | --- | --- | --- |
| Header signature scan | 2.83 MB | 20,000 | 5.19 ms | 3,852,946/sec | 544.6 MB/s |
| robots.txt path match | 3.32 MB | 60,000 | 9.64 ms | 6,223,689/sec | 344.3 MB/s |

Median of 7 runs after warmup, on Apple M5 Pro, 24 GB RAM, Node 24.3.0. Inputs are generated
by `scripts/benchmark.ts` rather than checked in, so the sizes above are
exactly what was measured. Reproduce with `bun run benchmark`.

These are machine-specific and are not asserted in CI — a benchmark that gates
a build only tells you how busy the runner was.
<!-- performance:end -->

## Testing

<!-- coverage:start -->
| Metric | Coverage |
| --- | --- |
| Statements | 92.96% |
| Branches | 83.12% |
| Functions | 95.13% |
| Lines | 94.40% |

372 test cases across 29 files, plus an integration suite that runs
in a real VS Code extension host and an end-to-end test that installs the
built `.vsix` into a clean profile.

Generated from a real run — `coverage/coverage-summary.json` and
`coverage/test-results.json` — by `scripts/coverage-readme.js`; CI fails if
this section drifts. Reproduce with `bun run test:coverage`, and the case
count is the one vitest prints.
<!-- coverage:end -->

## More from the LE family

Sixteen single-purpose tools for the work in front of every model. Each ships
a Rust CLI and an MCP server. One page: **[letools.dev](https://letools.dev)**

**Get it out**

- **[String-LE](https://letools.dev/tools/string-le)** — Extract every string in a codebase, with its position, so a person can read them
- **[Numbers-LE](https://letools.dev/tools/numbers-le)** — Extract every hardcoded number in a codebase, so a person can check them
- **[Units-LE](https://letools.dev/tools/units-le)** — Extract every quantity with its unit, normalized, and refuse the ambiguous ones by name
- **[Dates-LE](https://letools.dev/tools/dates-le)** — Extract every date and timestamp, and the exact instant each one resolves to
- **[IDs-LE](https://letools.dev/tools/ids-le)** — Extract every UUID, ULID, NanoID, ObjectId and Snowflake, and decode the time inside
- **[IPs-LE](https://letools.dev/tools/ips-le)** — Extract every IP address, CIDR block and MAC, normalized and classified by scope
- **[URLs-LE](https://letools.dev/tools/urls-le)** — Extract every URL in a codebase, with its protocol and exact position
- **[Paths-LE](https://letools.dev/tools/paths-le)** — Extract every file path in a codebase, and say whether it still points at anything
- **[Colors-LE](https://letools.dev/tools/colors-le)** — Extract every color in a codebase, and say which ones are not in your palette

**Check it**

- **[Regex-LE](https://letools.dev/tools/regex-le)** — Find every regex in a codebase, and report which can be driven into catastrophic backtracking
- **[Versions-LE](https://letools.dev/tools/versions-le)** — Find where one dependency is constrained differently across a repository's manifests
- **[i18n-LE](https://letools.dev/tools/i18n-le)** — Identify the i18n library a project uses, then audit its catalogs by that library's rules
- **[Scrape-LE](https://letools.dev/tools/scrape-le)** — Check whether a page is scrapeable before the scraper is written, and say when it cannot tell

**Guard it**

- **[Secrets-LE](https://letools.dev/tools/secrets-le)** — Find hardcoded credentials in a codebase, and never print one into the report
- **[EnvSync-LE](https://letools.dev/tools/envsync-le)** — Compare the dotenv files in a tree, and say which keys are missing from which
- **[Unicode-LE](https://letools.dev/tools/unicode-le)** — Find the Unicode that hides meaning — bidi controls, invisibles, homoglyphs, mixed scripts

Each stands on its own: no shared crate, no published core. Where two of them
agree, it is because the same answer was right twice.

**Contact** — [nolindnaidoo.com](https://nolindnaidoo.com) · [GitHub](https://github.com/nolindnaidoo) · [LinkedIn](https://www.linkedin.com/in/nolindnaidoo/)

## Also by nolindnaidoo

**Rust** — pixelcoords and pixelactions are one loop: pixelcoords answers
*where*, pixelactions *acts* there. Their own tools, their own voice — not
part of the LE family.

- **[pixelcoords](https://github.com/nolindnaidoo/pixelcoords)** — Freeze your screen, mark regions, get pixel-exact coordinates and crops
  [pixelcoords.dev](https://pixelcoords.dev) · [crates.io](https://crates.io/crates/pixelcoords) · [docs.rs](https://docs.rs/pixelcoords)
- **[pixelactions](https://github.com/nolindnaidoo/pixelactions)** — Consume human-verified coordinates, perform the interaction, confirm it landed
  [pixelactions.dev](https://pixelactions.dev) · [crates.io](https://crates.io/crates/pixelactions) · [docs.rs](https://docs.rs/pixelactions)

## License

MIT © [nolindnaidoo](https://github.com/nolindnaidoo)
