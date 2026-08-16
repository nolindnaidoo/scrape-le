# Changelog

All notable changes to the scrape-le CLI are documented here. The VS
Code extension in the same repository keeps its own
[CHANGELOG](../CHANGELOG.md) and its own version.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-08-16

### Fixed

- **`--ignore-crawl-delay` left no trace in the report it produced.** A
  three-URL batch on one host declaring `Crawl-delay: 2` dropped from
  4.03s to 0.02s and the reports were byte-identical apart from
  `timing_ms` — so a run that skipped the wait could not be told from
  one that waited, which README, SPEC.md and `--help` all promise it
  can. Every report now carries `crawl_delay_ignored`, and the human
  summary says the same for a single URL and for a batch.

- **A page-probe finding named its source and not its signal.** Only
  header matches carried `evidence.signal`; a script src, a DOM element
  or a window global reported `{"source": "DOM element"}` and nothing
  else, so *which* selector fired — the one thing that dismisses a false
  positive — never left the browser. SPEC.md has always said each
  finding names the signal that fired. The page probe now answers with
  the matched signal per source rather than a boolean.

- **A batch overwrote one screenshot and the reports pointed at the
  wrong image.** The filename was the host plus the date, so three URLs
  on one host wrote `scrape-le-127-0-0-1-2026-08-16.png` three times and
  two of the three reports named a picture of a page they had not
  checked. The name now carries a digest of the whole URL.

- **A malformed batch entry did not decide the exit code.** SPEC.md says
  a malformed entry is exit 2 naming the line; the line was named and
  the code escalated only when every URL that ran came back `clear`, so
  a malformed entry beside a `restricted`, `blocked` or `inconclusive`
  one exited 1. The worst-outcome comparison ranked 2 below 1.

- **A scheme this tool cannot answer for was refused as a DNS failure.**
  `HTTP://host/path`, `ftp://` and `file://` all came back "DNS failure:
  failed to lookup address information" — an error about the network for
  a question about the scheme — because the blind `https://` prefixing
  turned each into a *host* called `http`, `ftp` or `file`. RFC 3986
  §3.1 makes a scheme case-insensitive and `fixtures/url.json` pins
  `HTTPS://EXAMPLE.COM` valid, so the shared corpus already said an
  upper-case scheme must be accepted. Both surfaces now check it, and
  refuse the rest the way `javascript:` and `data:` were always refused.

### Changed

- **`evidence.source` is a machine token throughout** —
  `response-header`, `script-src`, `dom-element`, `window-global`. It was
  one slug beside three prose values, and SPEC.md documented a spelling
  nothing emitted. The prose lives on in `detail`, which is the string
  the extension prints and the parity corpus pins.

- **The screenshot filename gained a digest of the URL**:
  `scrape-le-<host>-<date>-<digest>.png`. A same-day re-check of the
  same URL still overwrites its own image. That the PNG is written to
  the working directory is now stated in `--help`, the README and
  SPEC.md, where nothing said it before.

- **The report always carries `crawl_delay_ignored`**, false on a polite
  run. A field that disappeared when false would leave the two runs
  identical again.

## [0.2.0] - 2026-08-15

### Fixed

- **A 5xx robots.txt no longer reads as "nothing forbids you".** RFC
  9309 §2.3.1.3 makes an *unavailable* robots.txt — a 404 — allow
  crawling; §2.3.1.4 makes an *unreachable* one — 5xx or a network
  failure — a complete disallow. Both collapsed to "no robots.txt", so a
  500 reported `exists: false, allows_crawling: true`. That is
  over-optimism in the one direction SPEC.md forbids, and it already
  said so about the batch cache.

### Changed

- **The report distinguishes the two.** An unreachable robots.txt keeps
  `exists: false` — no file was served — and its finding reads
  *robots.txt could not be read; assuming complete disallow (RFC 9309
  §2.3.1.4)*, quoting no rule. An earlier cut of this fix produced the
  right verdict with a fabricated explanation, `Disallow: / for
  User-agent: *`, which a reader could have disproved by fetching the
  file.

- The assumed document is **not cached**, so a transient failure does
  not disallow every remaining URL on that host. The existing regression
  covering exactly that caught the first attempt, which did cache it.

## [0.1.5] - 2026-08-15

### Fixed

- **A remote `Crawl-delay` can no longer end the process.**
  `Crawl-delay: Infinity` is a legal parse — the spec pins
  `Number.parseFloat` semantics and `parseFloat("Infinity")` is
  infinite — and it reached `Duration::from_secs_f64`, which panics on a
  non-finite float. The panic crossed a scoped thread and killed the
  whole batch: exit 101, and stdout carried nothing at all, including
  the URLs already fetched and reported. Any site could do it.

- **A `Crawl-delay` is capped at five minutes.** `Crawl-delay: 1e18`
  never panicked; it slept for roughly thirty-one billion years, which
  is the same outage without a message. A plain typo —
  `Crawl-delay: 100000000000` — did the same. `robots.crawl_delay` still
  reports the declared value verbatim, so the output does not
  misrepresent what the site asked for.

  The cap is applied *before* the conversion, not after: `1e300` is
  finite and positive and still too large for a `Duration`, so clamping
  the result would have left the panic in place. The regression test
  found that, having been written first.

## [0.1.4] - 2026-08-15

### Added

- **The crates.io page carries a demo of the CLI.** It had the icon and
  nothing else, because the only recording in the repository was of the
  VS Code extension reading an editor buffer — a clip of something this
  binary does not do. `assets/demo.tape` records the real binary against
  the files in `assets/demo/`, so the clip is reproducible (`cd assets
  && vhs demo.tape`) rather than an artifact nobody can regenerate.

## [0.1.3] - 2026-08-15

### Fixed

- **The crates.io page shows the icon.** It lived only in the repository
  README, and that file is not the one `cargo publish` ships — the
  published README is this directory's. A relative path would not have
  fixed it: the crate is published from `crate/`, so crates.io resolves
  a relative link against `path_in_vcs` and looks for the asset below
  the crate directory rather than beside it. The image is an absolute
  URL, which every surface renders.

  No demo goes with it. `src/assets/images/demo.gif` records the
  extension reading an editor buffer, which is not what this binary
  does; the demo that belongs here is a recording of the CLI, and there
  is not one yet.

## [0.1.2] - 2026-08-14

### Fixed

- **A robots.txt with a non-ASCII rule could be read two ways.**
  Longest-match-wins compares how long each rule is, and this counted
  bytes while the VS Code extension counts characters the way JavaScript
  does — so a rule beside `/café` won the tie in one and lost it in the
  other, and the same file said a path was disallowed here and allowed
  there. It now counts the way the extension counts.
- **A second `Crawl-delay` is honoured.** A file that declares one for
  `User-agent: *` twice reported the first; the extension reports the
  last, and now so does this.
- **`Crawl-delay: infinity` is not a number.** Rust reads `inf`,
  `infinity` and `nan` where JavaScript reads none of them, so a file
  with one had the two servers report different delays.
- **A batch file saved with a byte-order mark is read as JSON again.**
  Those three invisible bytes — what Notepad, Excel and a PowerShell
  redirect all add — stopped the file starting with `[`, and a
  fifty-URL array was read as one malformed line with nothing on screen
  to explain it.
- **A named pipe is refused instead of hanging.** `--signatures` and
  `--input` read the file they are given, and reading a pipe with no
  writer never returns.
- **A page title survives a character that changes length when
  lowercased.** The `--no-render` path found the `<title>` tag in a
  lowered copy and sliced the original, and `İ` and `K` are not the same
  length in both — the title came back wrong or not at all.

### Changed

- Each robots.txt rule is compiled once when the file is parsed rather
  than once per path checked. No change to any answer.
- **A batch reads a site's robots.txt once, not once per URL.** Fifty
  paths on one site used to fetch and re-parse the same file fifty
  times, compiling every rule again for an answer that could not have
  changed; it is now fetched and parsed once per origin and the rest
  read the rules already in hand. A batch of 200 URLs across 8 sites
  went from 200 robots.txt requests to 8, and from 0.29 s to 0.08 s with
  a 250-rule file — 0.83 s to 0.13 s with a 1000-rule one. Held per
  origin, so `http://` and `https://` on one host stay separate; nothing
  is kept when a fetch fails, so a blip cannot read as permission for
  the rest of the run. **No change to any answer** — a batch's reports
  are byte-identical before and after.

## [0.1.1] - 2026-08-07

### Changed

- Documentation only. The family list in the README points at each tool's page
  on letools.dev rather than its VS Code Marketplace listing, and `homepage`
  resolves to this tool's own page rather than the site index.

## [0.1.0] - 2026-08-06

First release: the command-line and MCP frontend of Scrape-LE, ported
from the VS Code extension against a signature corpus both share.

### Added

- **`scrape-le <url>`** — loads the page in a browser you already have,
  runs all four detections (anti-bot vendors, rate limiting, robots.txt,
  authentication), and reports a verdict with the evidence behind it.
  The JSON report goes to stdout, a human summary to stderr.
- **Exit codes as the API** — `0` clear, `1` a real no
  (`restricted`/`blocked`/`inconclusive`), `2` the question was
  malformed. For a batch, the worst verdict in it.
- **The completeness rule** — `clear` requires every check to have run,
  `restricted` does not. A `Disallow` or a 401 is true whether or not
  the page rendered, but absence cannot be claimed for a check that did
  not run, so a `--no-render` run can never come back `clear` and the
  report says which checks were partial.
- **`--input <file|->`** — batch input as a JSON array, a CSV with a
  `url` column, or one URL per line, detected by content rather than
  extension. Hosts run in parallel (4 by default, `--concurrency`);
  URLs within a host run sequentially and never concurrently, because a
  tool that asks whether a site may be scraped must not hammer it while
  asking. `Crawl-delay` is honoured between same-host requests,
  robots.txt is fetched once per host, exact-duplicate URLs are checked
  once, and reports stream as they complete carrying their input index.
- **`scrape-le mcp`** — the same checks over the Model Context Protocol
  on stdio: `analyze_robots_txt`, `scrape_le_check`, `scrape_le_doctor`.
  `analyze_robots_txt` is the same tool the npm server
  [`scrape-le-mcp`](https://www.npmjs.com/package/scrape-le-mcp) offers,
  with byte-identical output, so one tool name works whichever server a
  host has configured.
- **`scrape-le doctor`** — whether a browser is available, which one,
  and which checks can run completely.
- **`--agent <token>`** — evaluates robots.txt as a named crawler with
  RFC 9309 group selection. Without it the generic (`User-agent: *`)
  rules are used, identically to the extension.
- **`--signatures <file>`** — adds or replaces vendor signatures from a
  TOML file, so a vendor changing a script URL is a data edit rather
  than a release.
- **`--no-render`** for CI, and `--ignore-crawl-delay`, which is
  recorded in the report when used so the output cannot misrepresent
  how it was obtained.

### Notes

- **A browser is required and never downloaded.** Discovery looks for
  Chrome, Chromium, Brave and Edge, and honours a `CHROME` override. If
  none is found, the tool says so and names the fix rather than
  fetching 130 MB nobody asked for. It stays useful without one:
  robots.txt, status, redirects and rate-limit headers are plain HTTP.
- **One page load per check.** The document's status and response
  headers come from its own CDP response, so a rendered check hits the
  site once. `robots.txt` is the only additional request.
- **No async runtime**, matching pixelcoords and pixelactions: sync CDP,
  `ureq`, and std threads.
- Two deliberate differences from the extension, both documented: the
  `retry.userAgents` setting is not ported, and `--agent` fixes a
  limitation the extension states.

[0.3.0]: https://crates.io/crates/scrape-le/0.3.0
[0.2.0]: https://crates.io/crates/scrape-le/0.2.0
[0.1.5]: https://crates.io/crates/scrape-le/0.1.5
[0.1.4]: https://crates.io/crates/scrape-le/0.1.4
[0.1.3]: https://crates.io/crates/scrape-le/0.1.3
[0.1.2]: https://crates.io/crates/scrape-le/0.1.2
[0.1.1]: https://crates.io/crates/scrape-le/0.1.1
[0.1.0]: https://crates.io/crates/scrape-le/0.1.0
