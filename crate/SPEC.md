# scrape-le — Rust specification

A port of the [Scrape-LE](https://github.com/nolindnaidoo/scrape-le) VS
Code extension to a Rust CLI and MCP server.

**Parity first.** The extension is the reference implementation. Anything
this produces for a given URL must match what the extension produces for
that URL. A difference is a regression until proven otherwise — not an
improvement. Enhancements come after parity, and are listed at the bottom
so nobody smuggles one in early.

## The one question

**Can I scrape this URL?**

Not *scrape this URL*. Not *how do I get past this*. One question, asked
before a line of scraper code exists, answered as a report a person reads
and an exit code a script branches on.

## Why this is not a scraper

The temptation, at every design decision, will be to add extraction. A
selector engine is right there. Resist it, for a structural reason:

**A tool that scrapes has an incentive to say yes.** The moment this
thing can fetch data for you, "is it scrapeable" stops being a neutral
question and becomes a sales pitch for its own next feature. The answer
is only worth having because nothing downstream depends on it being
positive.

Same reason pixelcoords never moves the mouse.

## Shape

**One crate.** Not the two-crate split pixelcoords and pixelactions use —
those split because pixelactions genuinely consumes `pixelcoords-core`.
There is no second consumer here, so a published `-core` would be
packaging ceremony that hands the detection logic to anyone who wants to
rebuild this.

The separation that matters is architectural, and an internal module
boundary gives all of it:

```
crate/              (in the extension's repo — the shared corpus lives
└── src/             beside it at ../signatures/ and ../fixtures/)
    ├── detect/     pure: signatures, robots.txt, verdict logic. No I/O.
    ├── fetch.rs    HTTP
    ├── render.rs   Chromium
    ├── cli.rs
    └── mcp.rs
```

**`detect/` touches no network and drives no browser.** It takes evidence
— headers, a status code, raw HTML, a rendered DOM snapshot, a robots.txt
body, a URL — and returns findings. The entire decision layer is testable
from a fixture file: no display, no network, no flake. It is `pub(crate)`
and carries the 90% per-module coverage floor, which is the only thing
the split was ever for.

Everything outside `detect/` is what cannot be tested that way: fetching,
rendering, and the two surfaces.

**Both surfaces are one implementation.** The CLI and the MCP server call
the same `check()` in `detect/`. A surface that grows its own copy of a
detection is a bug.

Going one crate → two later is cheap if a second consumer ever appears.
Going two → one after publishing means yanking a crate, so the reversible
direction is the one taken here.

## Detections — the four the extension has

Ported as-is, including limitations. Where the extension is limited, this
is limited the same way, and the limitation is written down rather than
quietly fixed — otherwise "parity" cannot be tested.

### 1. Anti-bot vendors

Fingerprinted from response headers, script sources, DOM elements and
window globals. **The extension's existing signatures are the corpus** —
Cloudflare (including Turnstile challenges), reCAPTCHA, hCaptcha,
DataDome, PerimeterX.

Signatures live in TOML rather than Rust: a vendor changing a script URL
should be a data edit, reviewable by someone who does not write Rust.
Each finding carries its source: which signal fired, and whether it came
from a response header, a script src, a DOM element or a window global.
**Confidence is not yet a corpus field** — a `window.turnstile` global is
near-certain while a `cf-ray` header only means Cloudflare fronts the
site, and the report conveys that through the evidence rather than a
weight. Per-signal claims are listed under enhancements.

### 2. Rate limiting

`X-RateLimit-*`, `RateLimit-*`, `Retry-After`, and HTTP 429.

### 3. robots.txt

Fetches `<origin>/robots.txt` and evaluates the **`User-agent: *`** rules
against the URL with RFC 9309 semantics: grouped agents, `Allow`/`Disallow`
longest-match, `*` wildcards, `$` anchors, crawl-delay, sitemaps.

**Flagless, agent-specific groups are ignored, exactly as the extension
ignores them** — so every default invocation stays byte-identical to the
reference implementation, and the parity corpus tests both sides.

**`--agent MyBot/1.0` opts into RFC 9309 group selection**, evaluating
that agent's group instead. The divergence is deliberate and recorded:
the answering group is named in the report (`robots.agent`) and in the
finding's evidence, and the fixture cases that diverge carry a
`divergence` annotation that is itself asserted by a test. Reporting
"robots allows you" while ignoring the group that names the caller is
the same over-optimism as defaulting to `--no-render`.

Sitemaps are reported, never fetched — they come out of a file already
retrieved, so listing them is free, while following one has no natural
stopping point and would make this a crawler.

Build on `texting_robots`: RFC 9309 verified in its source, tested
against Google's C++ suite and 34M Common Crawl responses.

### 4. Authentication

HTTP 401/403, login forms (a password field plus a username field), auth
keywords in page text, and auth path segments in the final URL after
redirects.

### Also reported

Status, page title, load time, console errors, and a full-page
screenshot — as the extension reports them.

## Output

One JSON report per URL on stdout, a human summary on stderr, and an exit
code. **There is no `--json` flag**: stdout is always protocol and stderr
is always for the human, so piping works bare and there is no mode to
misremember. The human summary is a projection of the same report, never
a second prose generator that could drift from it.

```json
{
  "schema": 1,
  "url": "https://example.com/search?q=x",
  "final_url": "https://example.com/search?q=x",
  "status": 200,
  "title": "Search — Example",
  "verdict": "restricted",
  "findings": [
    { "kind": "robots", "severity": "blocks",
      "detail": "Disallow: /search for User-agent: *",
      "evidence": { "rule": "Disallow: /search", "agent": "*" } },
    { "kind": "antibot", "severity": "warns",
      "detail": "Cloudflare Turnstile widget present",
      "evidence": { "signal": "window.turnstile", "source": "window-global" } }
  ],
  "checks": { "antibot": "ran", "rate_limit": "ran",
              "robots": "ran", "auth": "ran" },
  "checks_skipped": [],
  "console_errors": [],
  "screenshot": "./scrape-le-example.com-20260805.png",
  "timing_ms": { "fetch": 210, "render": 1840, "total": 2104 }
}
```

**Every finding carries its evidence** — not "Cloudflare detected" but
which signal, from which source. A reader who disagrees can check the
reasoning, and a false positive is diagnosable rather than mysterious.

### Verdicts

| Verdict | Means |
|---|---|
| `clear` | every check ran, and nothing found would stop a naive scraper |
| `restricted` | something would stop or limit you — see findings |
| `blocked` | the page could not be reached or rendered at all |
| `inconclusive` | nothing blocking was found, **but not every check ran** |

**`clear` requires completeness; `restricted` does not.**

> A positive finding does not need completeness. A negative one does.

A `Disallow` or a 401 is true whether or not the page rendered, so a
partial run can say `restricted` honestly. But `clear` is a claim about
*absence*, and absence cannot be claimed for a check that did not run.

### Exit codes

| Code | Meaning |
|---|---|
| 0 | `clear` |
| 1 | `restricted`, `blocked`, or `inconclusive` — not a yes |
| 2 | the question was malformed — unparseable URL, DNS failure, timeout |

For a batch, the exit code is the worst across all URLs.

## CLI

```bash
scrape-le https://example.com                  # one URL

scrape-le --input urls.json                    # ["https://a.com", "https://b.com"]
scrape-le --input urls.csv                     # one URL per line, or a `url` column
scrape-le --input -                            # the same, from stdin

scrape-le --no-render https://example.com      # no browser; cannot return `clear`
scrape-le --signatures ./my.toml               # extra or replacement signatures
scrape-le doctor                               # is a browser present, and which
```

**Batch input takes JSON or CSV, detected by content rather than
extension.** A JSON array of strings, a JSON array of objects with a
`url` key, a CSV with a `url` column, or a bare newline-separated list.

A malformed entry is exit 2 naming the line — it does not poison the rest
of the batch, which still runs and still reports. How a batch is
scheduled is **Batches** below.

## Batches

### The rule everything follows from

**Never two concurrent requests to the same host.**

This tool's premise is asking whether it is acceptable to hit a site.
Hammering one while asking is self-defeating, and a batch of a hundred
URLs is very often a hundred paths on *one* site.

So: **group by host, run hosts in parallel, run URLs within a host
sequentially.** Concurrency is a property of the host set, never of the
URL count. Ten thousand URLs on one host is a queue of ten thousand, one
at a time, and that is correct.

### What falls out of it

**robots.txt is fetched once per host, not once per URL.** A hundred URLs
on one host is one robots.txt request. Faster and politer, and free —
the grouping already exists.

**`Crawl-delay` is honored between same-host requests.** The parser
already reads it. Reporting a site's declared delay while ignoring it is
hypocrisy the rest of this design does not permit. `--ignore-crawl-delay`
is the explicit opt-out, and the report records that it was used, so the
output cannot misrepresent how it was obtained.

**Exact-duplicate URLs are checked once.** Same URL, same run, same
answer — a second render spends two seconds to learn nothing. Each input
index still gets its own record.

### Defaults

| | Default | Why |
|---|---|---|
| Concurrent hosts | **4** | Chromium contexts are the scarce resource, not sockets |
| Same host | **1, always** | Not configurable — the rule, not a tuning knob |
| Retries | **0** | A failure is a finding (`blocked`). Retrying means hitting a site harder because it did not like you the first time |

`--concurrency N` raises the host count. A `--no-render` batch could take
far more, but one default ships rather than two; a big HTTP-only run can
pass the flag.

### Output

**Each report streams as it completes, carrying an `index`** — not
buffered into input order.

Buffering would mean no output until the slowest URL finishes, and the
whole batch held in memory. Streaming is memory-flat, gives results as
they arrive, and restoring input order is a sort on `index` for whoever
wants it.

One URL failing never stops the batch. A final summary goes to stderr,
stdout stays protocol:

```
40 clear · 12 restricted · 3 blocked · 1 inconclusive
56 URLs across 9 hosts in 47s
```

**The exit code is the worst verdict in the batch.**

## MCP

`scrape-le mcp` serves the same `check()` over the Model Context Protocol
on stdio, so a model can ask the question instead of being handed a page
and guessing.

| Tool | Does |
|---|---|
| `scrape_le_check` | one URL, or an array of them; returns the report(s) |
| `scrape_le_doctor` | is a browser available, which one, what will run |

**Read-only by construction.** There is no acting surface here, so unlike
pixelactions there is no consent gate to design — the worst this can do
is fetch a page.

Two rules borrowed from the other tools' MCP surfaces:

- **A negative answer is not an error.** `restricted` and `inconclusive`
  come back as ordinary results with `ok: false`. Only a malformed
  question — an unparseable URL — is a protocol error. A model that reads
  a refusal as a broken tool retries instead of reacting.
- **Refusals speak the caller's vocabulary.** An MCP caller has no command
  line, so no message mentions `--no-render` or any other flag.

## The browser

**Required, never downloaded.** `headless_chrome` drives a Chromium the
user already has — sync CDP, no async runtime, same rule as pixelcoords
and pixelactions. Discovery keeps its own candidate list (Chrome,
Chromium, Brave, Edge) plus a `CHROME`-style env override; the crate's
`default_executable()` knows only Chrome/Chromium, verified against a
Brave-only machine. If no browser is found the tool says so and names
the fix; it does not fetch 130 MB on first run.

The extension does download one, behind an explicit `Setup Browser`
command — that works because an extension has a UI to explain itself.
`cargo install scrape-le` followed by a silent 130 MB download is the
tool doing something nobody asked for.

`scrape-le doctor` answers it up front, the same job `pixelactions doctor`
does for the pixelcoords binary.

This is only tolerable because **the tool is useful without one.**
robots.txt, status, redirects, rate-limit headers and auth-by-status are
plain HTTP. The browser buys window globals and post-JS DOM — and the
report says plainly when it was not available.

**Rendering is the default.** Without it, most anti-bot detection is
lost, which makes a no-render run systematically over-optimistic. A tool
whose value is an honest answer must not default to the mode that
produces the least honest one. `--no-render` stays first-class for CI,
and stays honest because of the completeness rule.

## Non-goals

- **Not a scraper.** No selectors, no extraction, no pagination, no
  crawling beyond the single URL and its `robots.txt`.
- **Not a bypass tool.** Never solves a captcha, never rotates a proxy,
  never impersonates a TLS fingerprint. Detection informs a person; it
  does not feed an evasion loop.
- **Not a legal opinion.** robots.txt and Terms of Service are inputs. A
  `clear` verdict is about *mechanisms*, never permission.
- **No daemon, no HTTP server.** stdio and an exit code, or nothing —
  MCP is stdio with the caller that launched it.
- **No account, no key, no telemetry.**

## What the answer is worth — say this in the README

One load, from one IP, with one fingerprint, at one moment.

- A `clear` verdict is a **floor, not a prediction.** It says a naive
  scraper is not stopped right now, from here.
- A detected widget means the page *can* challenge you, not that it will.
- Signatures are fingerprints of public integration patterns. Vendors
  change them.
- **A clear result is not permission.**

The extension already says this. It is not boilerplate — it is why the
tool can be trusted at all.

## Testing

| Layer | How |
|---|---|
| `detect/` | Unit tests from fixtures — a header map, an HTML string, a robots.txt body. 90% per-module floor. No network, no browser. |
| Signatures | Each TOML rule ships a fixture it must match and one it must not. A signature with no negative case is a false-positive generator. |
| Verdict logic | Property test: no single `warns` finding produces `blocked`; `clear` requires zero `blocks` **and** zero skipped checks. |
| Surfaces | The CLI and MCP must return identical findings for the same URL — asserted directly, so neither can drift. |
| Exit codes | Contract tests against a local fixture server. No display; runs anywhere. |
| Render | Scenario tests against a real Chromium in CI, on three platforms. |
| **Parity** | A fixture corpus both the extension and this run against, asserting identical findings. This is what makes "the port is done" a fact. |

## Enhancements — after parity, not before

Listed so they are not smuggled into the port. Each is worth doing; none
is worth doing first.

1. **Wider vendor coverage.** `spider`'s `AntiBotTech` enum names 30 —
   Kasada, Arkose Labs, Imperva, HUMAN, Akamai Bot Manager, FingerprintJS,
   Queue-It, AWS WAF, Sucuri, Wordfence, GeeTest, Alibaba TMD, Vercel and
   more. A maintained list someone else keeps current.
2. **JavaScript requirement.** Raw HTML versus rendered DOM — text ratio,
   link count, empty-shell detection. Nothing in any ecosystem reports
   this, and it is the thing a scraper author most needs before choosing
   `reqwest` over a browser.
3. **Honeypot links.** `display:none` links a headless browser would
   follow and a human never would. Informational only; must never move
   the verdict alone.
4. **Rate-limit budgets.** Report "100/hour, 14 remaining" rather than
   "rate limiting present".
5. **Per-signal confidence claims.** A closed vocabulary in the corpus
   (`vendor-fronts-site` for `cf-ray`, `challenge-present` for
   `window.turnstile`) that the verdict layer reads, instead of every
   signal carrying equal weight. Crate-only TOML fields, ignored by the
   extension and skipped by the parity checker.

