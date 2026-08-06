<h1 align="center">scrape-le</h1>

<p align="center">
  <b>Check whether a page is scrapeable before the scraper is written</b><br/>
  <i>robots.txt, anti-bot vendors, rate limits, auth walls — one verdict a script can branch on</i>
</p>

<p align="center">
  <a href="https://github.com/nolindnaidoo/scrape-le/actions/workflows/ci-crate.yml">
    <img src="https://github.com/nolindnaidoo/scrape-le/actions/workflows/ci-crate.yml/badge.svg" alt="Build Status" />
  </a>
  <img src="https://img.shields.io/badge/rustc-1.88+-93450a.svg" alt="MSRV: Rust 1.88+" />
  <a href="https://github.com/nolindnaidoo/scrape-le/blob/main/LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" />
  </a>
  <a href="https://letools.dev">
    <img src="https://img.shields.io/badge/web-letools.dev-00A0FF.svg" alt="letools.dev" />
  </a>
</p>

> **Useful?** A star is how other developers find it —
> [★ GitHub](https://github.com/nolindnaidoo/scrape-le) ·
> [letools.dev](https://letools.dev)

Most scraper failures are discovered after the scraper is written: the
page renders a challenge, robots.txt forbade the path all along, the
third request hits a rate limit. scrape-le asks first — it loads the
page the way a scraper would, gathers the evidence, and returns a
verdict with the receipts, as JSON on stdout and an exit code a script
can branch on.

It is the second frontend of
[Scrape-LE](https://github.com/nolindnaidoo/scrape-le#readme), the VS
Code extension — one product, two frontends, one repository, so the two
can never answer a URL differently. The signature corpus both build
against lives at
[`signatures/`](https://github.com/nolindnaidoo/scrape-le/tree/main/signatures)
and
[`fixtures/`](https://github.com/nolindnaidoo/scrape-le/tree/main/fixtures),
and CI fails on drift.

## Sixty seconds

```bash
scrape-le https://example.com/search      # one URL
scrape-le --input urls.txt                # a batch, streamed as it completes
scrape-le doctor                          # is a browser here, and which
```

```
restricted — 1 finding  (https://example.com/search · 1842ms · exit 1)
  blocks  robots     Disallow: /search for User-agent: *
  checks  antibot ✓  ·  rate-limit ✓  ·  robots ✓  ·  auth ✓
```

The report is JSON on stdout, the summary above is stderr, and the exit
code is the answer: **0 clear · 1 a real no · 2 the question was
malformed.** Every finding carries its evidence — not "Cloudflare
detected" but which signal, from which source — so a false positive is
diagnosable rather than mysterious.

## Status: works, not yet published

| Works today | Not here yet |
|---|---|
| Single-URL and batch checks, all four detections, all four verdicts, JSON reports, `--no-render`, `--agent`, `--signatures`, `doctor` | Publication — no crates.io release, no Homebrew or winget, no prebuilt binaries |
| The MCP surface (`scrape-le mcp`) with `analyze_robots_txt`, `scrape_le_check` and `scrape_le_doctor` | Signature confidence weights, and the wider vendor coverage listed in the spec's enhancements |
| Contract, scenario, property and parity tests; a 90% per-module coverage floor on the decision layer | |

## Install

Not yet published. Until the first `crate-v*` release:

```bash
git clone https://github.com/nolindnaidoo/scrape-le
cd scrape-le/crate
cargo build --release        # needs Rust 1.88+
./target/release/scrape-le --help
```

The eventual routes — crates.io, Homebrew, winget, prebuilt binaries —
follow the pixelcoords/pixelactions playbook and arrive with the
releases, not before.

## Verdicts

| Verdict | Means | Exit |
|---|---|---|
| `clear` | every check ran, and nothing found would stop a naive scraper | 0 |
| `restricted` | something would stop or limit you — see the findings | 1 |
| `blocked` | the page could not be reached or rendered at all | 1 |
| `inconclusive` | nothing blocking was found, **but not every check ran** | 1 |

**`clear` requires completeness; `restricted` does not.** A `Disallow`
or a 401 is true whether or not the page rendered, so a partial run can
say `restricted` honestly — but `clear` is a claim about *absence*, and
absence cannot be claimed for a check that did not run. That is why a
`--no-render` run can never come back `clear`, and why the report names
which checks were partial.

## Commands and flags

| | |
|---|---|
| `scrape-le <url>` | check one URL |
| `--input <file\|->` | batch: a JSON array, a CSV with a `url` column, or one URL per line — detected by content, not extension |
| `--no-render` | skip the browser; caps the verdict at `inconclusive` |
| `--agent <token>` | evaluate robots.txt as this crawler (RFC 9309 group selection) instead of `User-agent: *` |
| `--signatures <file>` | add or replace vendor signatures from a TOML file |
| `--concurrency <n>` | hosts checked at once (default 4); same-host URLs are always sequential |
| `--ignore-crawl-delay` | do not honour a declared `Crawl-delay`; recorded in the report when used |
| `doctor` | is a browser available, which one, what will run |
| `mcp` | serve the same checks over MCP on stdio |

## Two MCP servers, one tool contract

`scrape-le mcp` offers three tools; the published npm server
[`scrape-le-mcp`](https://www.npmjs.com/package/scrape-le-mcp) offers
one. The overlap is deliberate and enforced:

| Tool | npm server | this binary |
|---|---|---|
| `analyze_robots_txt` — content in, analysis out, no network | yes | yes, byte-identical |
| `scrape_le_check` — fetch, render, full verdict | — | yes |
| `scrape_le_doctor` — browser availability | — | yes |

The npm one runs anywhere with no install and no browser, which is why
it ships inside the VS Code extension and works over `npx`. This one
needs the binary and a Chromium. Writing `analyze_robots_txt` once means
one tool name works whichever server a host has configured; a shared
fixture corpus runs against both implementations and fails either build
if they drift.

## Batches

One rule generates the rest: **never two concurrent requests to the same
host.** A tool whose premise is asking whether it is acceptable to hit a
site cannot hammer that site while asking, and a batch of a hundred URLs
is very often a hundred paths on one site. So hosts run in parallel,
URLs within a host run sequentially, `Crawl-delay` is honoured between
them, `robots.txt` is fetched once per host, exact-duplicate URLs are
checked once, and reports stream as they complete carrying their input
`index`. The exit code is the worst verdict in the batch.

## Design commitments

These hold for every release, starting with the first:

- **A real browser, never downloaded.** It drives a Chromium you
  already have — Chrome, Chromium, Brave, or Edge — and if none is
  found it says so and names the fix, rather than fetching 130 MB on
  first run. The tool stays useful without one: robots.txt, status,
  redirects, and rate-limit headers are plain HTTP.
- **Rendering is the default**, because most anti-bot detection is
  invisible to a raw fetch, and a tool whose value is an honest answer
  must not default to the mode that produces the least honest one.
- **Exit codes are the API.** Scripts branch on them; for a batch, the
  exit code is the worst verdict in it.
- **Network scope is the URL under check plus that origin's
  `/robots.txt`.** Nothing else, ever. Generic User-Agent, no
  telemetry.
- **No async runtime.** Sync CDP (`headless_chrome`), `ureq`, and std
  threads — batching runs 4 hosts concurrently, sequential within a
  host, and never sends two concurrent requests to the same host.

## Non-goals

Not a scraper — no selectors, no extraction, no pagination, no crawling
beyond the single URL and its robots.txt. Not a bypass tool — it never
solves a captcha, never rotates a proxy, never impersonates a TLS
fingerprint. Detection informs a person; absence of a signature is not
permission to scrape.

## Documentation

- [SPEC.md](https://github.com/nolindnaidoo/scrape-le/blob/main/crate/SPEC.md) — the behavioral spec: verdicts, exit codes, batches, the browser, the MCP surface
- [AGENTS.md](https://github.com/nolindnaidoo/scrape-le/blob/main/crate/AGENTS.md) — engineering standards and the decisions already settled
- [signatures/](https://github.com/nolindnaidoo/scrape-le/tree/main/signatures) — the shared anti-bot signature corpus
- [fixtures/](https://github.com/nolindnaidoo/scrape-le/tree/main/fixtures) — the detection parity cases, divergences annotated
- [Scrape-LE, the VS Code extension](https://github.com/nolindnaidoo/scrape-le#readme) — the other frontend

## Also by nolindnaidoo

**Rust**

- **[pixelcoords](https://github.com/nolindnaidoo/pixelcoords)** - Mark pixel-exact coordinates machines can use · [pixelcoords.dev](https://pixelcoords.dev)
- **[pixelactions](https://github.com/nolindnaidoo/pixelactions)** - Perform the interaction and confirm it landed · [pixelactions.dev](https://pixelactions.dev)

**VS Code Extensions** — every tool in the family, one page: **[letools.dev](https://letools.dev)**

- **[String-LE](https://marketplace.visualstudio.com/items?itemName=nolindnaidoo.string-le)** - Extract string values for i18n from JSON, YAML, CSV, TOML, INI, and .env
- **[Numbers-LE](https://marketplace.visualstudio.com/items?itemName=nolindnaidoo.numbers-le)** - Extract numeric values from JSON, YAML, CSV, TOML, INI, and .env
- **[EnvSync-LE](https://marketplace.visualstudio.com/items?itemName=nolindnaidoo.envsync-le)** - Spot missing keys across your .env files, with a markdown report
- **[Paths-LE](https://marketplace.visualstudio.com/items?itemName=nolindnaidoo.paths-le)** - Extract file paths from JS/TS imports, JSON, HTML, CSS, TOML, CSV, and .env
- **[Secrets-LE](https://marketplace.visualstudio.com/items?itemName=nolindnaidoo.secrets-le)** - Detect and sanitize credentials locally, before you commit
- **[Scrape-LE](https://marketplace.visualstudio.com/items?itemName=nolindnaidoo.scrape-le)** - Check whether a page is scrapeable before you write the scraper
- **[Colors-LE](https://marketplace.visualstudio.com/items?itemName=nolindnaidoo.colors-le)** - Extract and analyze colors from CSS, SCSS, LESS, Stylus, HTML, JS/TS, and SVG
- **[URLs-LE](https://marketplace.visualstudio.com/items?itemName=nolindnaidoo.urls-le)** - Extract URLs from documentation, configs, and code
- **[Regex-LE](https://marketplace.visualstudio.com/items?itemName=nolindnaidoo.regex-le)** - Find, test, and validate the regex patterns in the current file
- **[Dates-LE](https://marketplace.visualstudio.com/items?itemName=nolindnaidoo.dates-le)** - Extract and analyze dates from logs, configs, and code

**Contact Developer** — [nolindnaidoo.com](https://nolindnaidoo.com) · [GitHub](https://github.com/nolindnaidoo) · [LinkedIn](https://www.linkedin.com/in/nolindnaidoo/)

## License

MIT — see [LICENSE](https://github.com/nolindnaidoo/scrape-le/blob/main/LICENSE).
