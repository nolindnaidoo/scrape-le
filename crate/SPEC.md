# scrape-le — Rust specification

A port of the [Scrape-LE](https://github.com/nolindnaidoo/scrape-le) VS
Code extension to a Rust CLI and MCP server.

**One answer is held equal; the surfaces are not.** The shared
`analyze_robots_txt` MCP tool must return the same the verdict, its signals, and their order
from either server — a difference there is a bug. Everything else is
IDE-first in the extension and terminal-first here, and is meant to
differ. See "Deliberate divergences".

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
and carries the 75% per-module coverage floor, which is the only thing
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
from a response header, a script src, a DOM element or a window global —
`signal` is the corpus value verbatim, and `source` is one of
`response-header`, `script-src`, `dom-element`, `window-global`. The
signal is the half that makes a false positive diagnosable: knowing a
selector matched is not knowing which selector, and the finding's
`detail` keeps the extension's wording while the evidence stays
machine-readable.
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

**Both sides are percent-encoded before they are compared** — §2.2.2:
"Octets in the URI and robots.txt paths outside the range of the ASCII
coded character set … MUST be percent-encoded … prior to comparison."
`Disallow: /café` therefore refuses `/café` and `/caf%C3%A9` alike; they
name one resource. Encoding covers octets outside ASCII and normalises an
existing `%xx` to upper case, which is the scope of Google's reference
parser's `MaybeEscapePattern` and no wider: reserved ASCII stays as
written, because a pattern's `*` and `$` are §2.2.3's special characters
and `/` is the path separator. A robots.txt meaning a literal asterisk
writes `%2A` itself.

The step is idempotent, and that is load-bearing rather than tidy: the
path arrives already encoded from `Url::path()` and raw from an MCP
caller that typed it, so both spellings have to land on one string.

**Not implemented, on purpose:** §2.2.2 also has a percent-encoded
*unreserved* octet decoded before comparison, so `/foo/%62%61%7A` would
match `/foo/baz`. Google's parser does not do it, and following the
reference keeps both frontends answering what the crawler ecosystem
answers; guessing wider here would move paths toward "allowed" on nobody
else's authority.

Findings quote the pattern **as the file spells it**, not the canonical
form — a reader should find the line this tool named when they open their
own robots.txt.

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

**The screenshot is written into the working directory** on every
rendered check, and `--help`, the README and the report all say so:
`scrape-le-<host>-<date>-<digest>.png`, the digest taken over the whole
URL. Host and date alone had a batch of paths on one site overwrite one
image and every report but the last name a picture of a page it had not
checked, so the name identifies the URL, not the site.

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
      "evidence": { "signal": "turnstile", "source": "window-global" } }
  ],
  "checks": { "antibot": "ran", "rate_limit": "ran",
              "robots": "ran", "auth": "ran" },
  "checks_skipped": [],
  "console_errors": [],
  "screenshot": "./scrape-le-example-com-2026-08-05-75e891e1.png",
  "crawl_delay_ignored": false,
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
of the batch, which still runs and still reports, and 2 outranks every
verdict the URLs that ran produced. How a batch is scheduled is
**Batches** below.

**The scheme decides whether the question can be asked at all.** `http`
and `https` in any case, because RFC 3986 §3.1 makes a scheme
case-insensitive and `fixtures/url.json` pins `HTTPS://EXAMPLE.COM`
valid; anything else — `ftp:`, `file:`, `javascript:`, `data:`,
`mailto:`, `tel:` — is exit 2 saying it is not an http(s) URL. A bare
`example.com` or `localhost:3000` is still prefixed with `https://`, the
corpus quirk; what is not prefixed is an input that already names a
scheme, which used to become a *host* called `ftp` and be refused as a
DNS failure.

**A scheme is read whether or not it carries `://`**, because that is the
shape the prefixing did real damage in: `mailto:x@y.com` became
`https://mailto:x@y.com` — userinfo `mailto:x`, host `y.com` — which
validates, so the run **fetched a host nobody named** from a string that
is not an http(s) URL at all. `localhost:3000` is the same shape and must
stay a host, so a colon names a scheme only when what follows it cannot
be a port; an empty port keeps `example.com:` a host, as the corpus pins.
An entry carrying `://` anywhere is read the way it always was, so
`warn: https://example.com/x` in a batch still yields its URL rather than
being refused as a scheme called `warn`.

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

**robots.txt is fetched and parsed once per origin, not once per URL.** A
hundred URLs on one site is one robots.txt request and one parse; the
rest read the rules already in hand. Faster and politer both.

The key is the **origin** — scheme, host and port — because that is what
decides the URL fetched, `<origin>/robots.txt`. `http://a.com` and
`https://a.com` may serve different rules and are held separately. This
is deliberately narrower than the key the *scheduler* groups on, which
is the host alone: never two concurrent requests to one machine,
whatever the scheme or port. Politeness is owed to a machine, an answer
belongs to a document.

**Only what an origin served is kept, never a failure to get it.** A
404, a 503, a refused connection or a timeout all mean this run has no
document, and all of them are asked again by the next URL on that host —
exactly as they were before anything was held. A blip must never read as
"nothing forbids you" for the rest of a batch.

The span is one run: a whole batch on the command line, a single
`scrape_le_check` call over MCP. The MCP server outlives any answer it
would be safe to keep, so it keeps none between calls.

**`Crawl-delay` is honored between same-host requests.** The parser
already reads it. Reporting a site's declared delay while ignoring it is
hypocrisy the rest of this design does not permit. `--ignore-crawl-delay`
is the explicit opt-out, and **every report of that run carries
`crawl_delay_ignored: true`**, with the batch summary and the single-URL
summary saying the same — so the output cannot misrepresent how it was
obtained. The field is always present: one that vanished when false
would leave a polite run and an impolite one byte-identical apart from
`timing_ms`, which is the same silence with extra steps.

The MCP surface has no such option and always reports `false`. That its
URLs carry no between-request wait at all is the terminal-only
divergence recorded below, not this flag.

**An unreachable robots.txt disallows everything; an absent one does
not.** RFC 9309 draws the line and this used to collapse it: §2.3.1.3
says an *unavailable* robots.txt — a 404 — allows crawling, because the
site has no rules, while §2.3.1.4 says an *unreachable* one — 5xx, or a
network failure — means a crawler "MUST assume complete disallow",
because the rules exist and could not be read. Both answered "no
robots.txt", so a 500 reported `exists: false, allows_crawling: true`:
"nothing forbids you", from a blip.

The report says which happened. `exists` stays **false** — no file was
served, and claiming one would have a reader fetch it, get a 500, and
find the explanation contradicted — and the finding reads *robots.txt
could not be read; assuming complete disallow*, quoting no rule. The
assumed document is **not cached**, so the next URL on that host asks
again rather than one dropped connection disallowing the rest of the run.

**A declared delay is capped at five minutes.** The value is a third
party's, so it is input rather than configuration, and two values a site
can legally declare took the process out. `Crawl-delay: Infinity` parses
— `Number.parseFloat` says so, per the rule below — and reached
`Duration::from_secs_f64`, which panics on a non-finite float; the panic
crossed a scoped thread and ended the batch, so stdout carried nothing
at all, including for URLs already fetched. `Crawl-delay: 1e18` did not
panic, it slept for roughly thirty-one billion years. A delay that is
not finite and positive is not waited for; one longer than five minutes
waits five. `robots.crawl_delay` still reports the declared value
verbatim, so a reader can see the site asked for more than was given.

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
| `analyze_robots_txt` | **the tool the npm server also offers** — robots.txt content in, analysis out, no network |
| `scrape_le_check` | one URL, or an array of them; returns the report(s) |
| `scrape_le_doctor` | is a browser available, which one, what will run |

**Two servers, one tool contract.** The published npm server
(`scrape-le-mcp`) runs anywhere with no install and no browser, which is
why it ships inside the extension and works over `npx`; this one needs
the binary and a Chromium, so it can never be `npx`-ed. Rather than
publish two products, `analyze_robots_txt` is offered by **both**, with
the same schema, the same envelope and byte-identical output —
`fixtures/mcp-analyze-robots.json` runs against both implementations and
fails either build on drift. This server is then a strict superset.

Every tool returns the same envelope, `{ ok, data, diagnostics, meta }`.

**Read-only by construction.** There is no acting surface here, so unlike
pixelactions there is no consent gate to design — the worst this can do
is fetch a page.

Two rules borrowed from the other tools' MCP surfaces:

- **A negative answer is not an error.** `restricted` and `inconclusive`
  come back as ordinary results, and **`ok` reports whether the check
  ran, not whether the answer is yes** — the verdict lives in `data`.
  Conflating the two would have a model report a broken tool when what
  it actually learned is that it should not scrape.
- **A bad argument is a tool failure, not a protocol failure.** An
  unparseable URL comes back as a result carrying `isError` so the model
  can read the reason and correct itself; a JSON-RPC error is reserved
  for protocol-level problems (an unknown method, an unknown tool),
  because that is what reads as "the server is broken".
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

## Deliberate divergences

The extension is **IDE-first**: one page, a person reading results in an
editor. The CLI is **terminal-first**: batches, exit codes, piping,
automation. Each works the way its own use case expects, so the list
below is design rather than drift.

- **Batching** — `--input`, host grouping, bounded concurrency,
  streaming and the crawl-delay wait are terminal-side only.
- **`--agent`** opts into RFC 9309 per-agent group selection. Flagless
  runs stay byte-identical to the extension, which evaluates only the
  generic `User-agent: *` group; the answering group is named in the
  report, and the fixture cases that diverge carry a `divergence`
  annotation a test asserts.
- **`--no-render`, `--signatures`, `doctor`** and the exit codes have no
  editor equivalent.
- **Raw-HTML `<title>` extraction** exists here and not there: the
  extension always renders and reads `document.title`.

What may **never** differ:

- **`analyze_robots_txt` is one tool, not two similar ones.** Same
  schema, same envelope, same answer, whichever server an agent reaches.
  `fixtures/mcp-analyze-robots.json` pins hand-written cases and
  `scripts/check-differential.ts` generates the rest.
- **The detection results themselves** — `src/detectors/` and
  `src/utils/url.ts` are the reference implementation, and
  `signatures/` + `fixtures/` are the contract.

### Numbers and lengths

Units are part of the answer rather than implementation details, and each
of these was found by the two servers disagreeing about a real file:

- **A pattern's length is counted on its percent-encoded form**, which
  RFC 9309 §2.2.2 calls "the most octets". The rule used to be "UTF-16
  code units, because the extension compares `pattern.length`" — a
  choice between two wrong units. `/café` is five UTF-16 code units and
  six bytes, so a neighbouring rule won a tie on one server and lost it
  on the other. Encoding first dissolves the question instead of picking
  a side: the canonical form is pure ASCII, where octets, characters and
  UTF-16 code units are one number, so `.length` in TypeScript and
  `str::len` in Rust count the same thing. Measuring one representation
  while comparing another was the incoherence underneath the divergence.

  The consequence is a real behaviour change, not a wash: `/café`
  encodes to ten octets, so a five-unit `/ca*e` beside it no longer ties
  with it and no longer wins.
- **`Crawl-delay` parses the way `Number.parseFloat` parses**, which
  reads only `Infinity` spelled exactly that way and never a NaN
  literal; Rust's own parser reads `inf`, `infinity` and `nan` in any
  casing.
- **The last applicable `Crawl-delay` wins**, across groups as well as
  within one, because the extension keeps assigning to a single value as
  it walks the file.

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
| `detect/` | Unit tests from fixtures — a header map, an HTML string, a robots.txt body. 75% per-module floor. No network, no browser. |
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

