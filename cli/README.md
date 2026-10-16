# scrape-le

Check whether a page is scrapeable before the scraper is written, and say
when it cannot tell.

```bash
npx scrape-le https://example.com/search
npx scrape-le --no-render https://example.com/search
npx scrape-le --input urls.txt
```

This is the same command line as the Rust crate
[`scrape-le`](https://crates.io/crates/scrape-le), and it behaves
identically: same flags, same requests, same output, same exit codes. Install
whichever toolchain you already have.

## What it checks

robots.txt, anti-bot vendors, rate limits and authentication walls, for one
URL or a batch. Every finding carries the signal that produced it: not
"Cloudflare detected" but which header, script, element or window global.

## The browser

Rendering is the default, and it drives a Chromium-family browser you already
have: Chrome, Chromium, Brave or Edge, or whatever `CHROME` names. It never
downloads one. `scrape-le doctor` says which it found.

Without a browser, or with `--no-render`, robots.txt, status, headers and
redirects still answer, but anti-bot and authentication run partially and the
verdict can never be `clear`. A rendered check writes a full-page PNG into the
working directory, one per URL per day, and the report names the file.

## Output

stdout carries one JSON report per URL whenever it is piped or redirected, and
nothing when it is a terminal. stderr carries the human summary.

```text
$ scrape-le --no-render 'http://127.0.0.1:8080/search?q=x'

restricted — 2 findings  (http://127.0.0.1:8080/search?q=x · 6ms · exit 1)
  warns   antibot    Cloudflare (cf-ray header)
  blocks  robots     Disallow: /search for User-agent: *
  robots  Crawl-delay: 2s (User-agent: *)
  checks  antibot partial (no render)  ·  rate-limit ✓  ·  robots ✓  ·  auth partial (no render)
  note    verdict cannot be `clear` until every check runs fully
```

```json
{"schema":1,"url":"http://127.0.0.1:8080/search?q=x","final_url":"http://127.0.0.1:8080/search?q=x","status":200,"title":"Search","verdict":"restricted","findings":[{"kind":"antibot","severity":"warns","detail":"Cloudflare (cf-ray header)","evidence":{"signal":"cf-ray","source":"response-header"}},{"kind":"robots","severity":"blocks","detail":"Disallow: /search for User-agent: *","evidence":{"agent":"*","rule":"Disallow: /search"}}],"checks":{"antibot":"partial","rate_limit":"ran","robots":"ran","auth":"partial"},"checks_skipped":["antibot","auth"],"robots":{"exists":true,"allows_crawling":false,"agent":"*","crawl_delay":2.0,"disallowed_paths":["/search"],"sitemaps":[]},"console_errors":[],"crawl_delay_ignored":false,"timing_ms":{"fetch":5,"total":6}}
```

## Batches

`--input` takes a JSON array, a CSV with a `url` column or one URL per line,
detected by content, from a file or from `-` for stdin. Hosts are checked in
parallel and the URLs of one host one at a time, never two at once, and a
declared `Crawl-delay` is waited out between them unless you pass
`--ignore-crawl-delay`. Reports stream as they complete and carry their input
`index`.

## Exit codes

- **0**: `clear`. Every check ran and nothing would stop a naive scraper.
- **1**: `restricted`, `blocked` or `inconclusive`. Not a yes.
- **2**: the question was malformed: not an http(s) URL, a name that does not
  resolve, a timeout. A batch exits with its worst outcome.

A `clear` verdict is about mechanisms, from one load, at one moment. It is a
floor, not a prediction, and it is not permission.

## For agents

`scrape-le mcp` serves the Model Context Protocol on stdio with three tools:
`analyze_robots_txt` for robots.txt content, `scrape_le_check` for one URL or
several, and `scrape_le_doctor`. Hosts that want the robots.txt analysis
alone, with no browser, can install
[`scrape-le-mcp`](https://www.npmjs.com/package/scrape-le-mcp).

`scrape-le --help` lists every option.

MIT licensed. Part of [letools](https://letools.dev/tools/scrape-le).
