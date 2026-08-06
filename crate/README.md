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

## Status: pre-release scaffolding

Said plainly, because a README that oversells an empty binary is the
opposite of what this tool is for:

| Exists today | Specified, not yet built |
|---|---|
| The crate builds under the full lint policy (clippy pedantic as errors, `unsafe` forbidden) and refuses honestly with exit 2 | The detection engine — the port of the extension's detectors |
| The shared signature corpus, fixture parity cases, and the CI gate that fails when either frontend drifts | Single-URL and batch checks, JSON reports, `--no-render`, the MCP surface |
| [SPEC.md](https://github.com/nolindnaidoo/scrape-le/blob/main/crate/SPEC.md) — the full behavioral spec: verdicts, exit codes, batching, refusal language | `cargo install scrape-le` — nothing is published until the engine lands |

## Install

Not yet published to crates.io. Until the first `crate-v*` release:

```bash
git clone https://github.com/nolindnaidoo/scrape-le
cd scrape-le/crate
cargo build --release        # needs Rust 1.88+
./target/release/scrape-le   # exits 2: not implemented yet
```

The eventual routes — crates.io, Homebrew, winget, prebuilt binaries —
follow the pixelcoords/pixelactions playbook and arrive with the
releases, not before.

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

**Contact Developer** — [GitHub](https://github.com/nolindnaidoo) · [LinkedIn](https://www.linkedin.com/in/nolindnaidoo/)

## License

MIT — see [LICENSE](https://github.com/nolindnaidoo/scrape-le/blob/main/LICENSE).
