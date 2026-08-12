# Changelog

All notable changes to the scrape-le CLI are documented here. The VS
Code extension in the same repository keeps its own
[CHANGELOG](../CHANGELOG.md) and its own version.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.2] - 2026-08-12

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
