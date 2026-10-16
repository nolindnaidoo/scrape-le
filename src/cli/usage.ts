/**
 * The command line's help text and the flags it names.
 *
 * Word for word the Rust CLI's, because both install as `scrape-le` and a
 * person reading `--help` cannot tell which one they have.
 * `scripts/check-cli-parity.ts` compares the two outputs, and `cli.test.ts`
 * holds FLAGS equal to the flags this text names.
 */

export const USAGE = `usage: scrape-le [options] <url>
       scrape-le [options] --input <file|->
       scrape-le doctor
       scrape-le mcp
       scrape-le --version | --help

Checks whether a page is scrapeable and reports what would block a
scraper: robots.txt, anti-bot vendors, rate limits, auth walls.
JSON reports on stdout when it is piped or redirected, human summary on
stderr. At a terminal stdout stays silent.

Options:
  --no-render            skip the browser; the verdict can then never be
                         \`clear\`, and the report says why
  --agent <token>        evaluate robots.txt as this crawler (RFC 9309
                         group selection); default is User-agent: *
  --signatures <file>    add or replace vendor signatures from a TOML file
  --input <file|->       batch: a JSON array, a CSV with a url column, or
                         one URL per line, detected by content
  --concurrency <n>      hosts checked at once (default 4). URLs on the
                         same host are always sequential
  --ignore-crawl-delay   do not honour a site's declared Crawl-delay;
                         recorded in the report when used

Rendering is the default and drives a browser you already have (Chrome,
Chromium, Brave, Edge — or set CHROME). It never downloads one. Every
rendered check writes a full-page PNG into the working directory, one
per URL per day, and the report names the file.

Exit codes: 0 clear · 1 restricted/blocked/inconclusive · 2 malformed question.
For a batch, the exit code is the worst verdict in it.`;

export const FLAGS: readonly string[] = Object.freeze([
	'--help',
	'-h',
	'--version',
	'-V',
	'--no-render',
	'--ignore-crawl-delay',
	'--agent',
	'--signatures',
	'--input',
	'--concurrency',
]);
