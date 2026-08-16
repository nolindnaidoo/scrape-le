/**
 * Generated cross-server parity for the tool BOTH MCP servers offer.
 *
 * `analyze_robots_txt` is one tool with one schema served by two
 * implementations — the npm server that ships inside the extension, and
 * the Rust CLI's. An agent asking it must get the same answer whichever
 * server it happens to reach, so this feeds generated robots.txt bodies
 * to both and requires the same envelope back.
 *
 * **Scope is the shared tool, deliberately.** The two surfaces around it
 * are allowed to differ and should: the extension is IDE-first, one page
 * and a person reading results in an editor; the CLI is terminal-first,
 * batches of URLs and an exit code a pipeline branches on. Batching,
 * `--agent`, `--no-render` and the exit codes exist on one side only and
 * that is not drift. `crate/SPEC.md` lists the deliberate ones.
 *
 * **`matchHeaders` is not reachable here**, and that is stated rather
 * than skipped: no shared MCP tool carries it, and the only other way to
 * reach the crate's copy is a page fetch, which these jobs must never
 * make. Its cross-frontend contract is `crate/fixtures/antibot-headers.json`,
 * run against both implementations by the `parity` job.
 *
 * The corpus in `crate/fixtures/robots/` pins cases somebody thought of.
 * This generates the ones nobody did: groups that repeat, agents that do
 * not match, crawl-delays that are not numbers, patterns with wildcards,
 * `$` anchors, non-ASCII, and paths given as whole URLs — which is how
 * `validateUrl` is reached from the same seam.
 *
 * Seeded and reproducible. The seed is printed on every run and named in
 * every failure.
 *
 * Run: bun scripts/check-differential.ts
 *   DIFFERENTIAL_SEED=123 DIFFERENTIAL_CASES=2000 bun scripts/check-differential.ts
 */
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { TOOLS } from '../src/mcp/tools';

const ROOT = join(import.meta.dir, '..');
const SEED = BigInt(process.env.DIFFERENTIAL_SEED ?? '20260812');
/** N >= 500: below that the group and pattern combinations are not all reached. */
const CASES = Number(process.env.DIFFERENTIAL_CASES ?? '600');
const BINARY =
	process.env.SCRAPE_LE_BIN ?? join(ROOT, 'crate', 'target', 'debug', 'scrape-le');

/**
 * xorshift64*, the same generator the crate's fuzz target uses. A
 * differential nobody can reproduce is a differential nobody fixes.
 */
class Seeded {
	private state: bigint;
	private static readonly MASK = (1n << 64n) - 1n;

	constructor(seed: bigint) {
		this.state = seed === 0n ? 1n : seed & Seeded.MASK;
	}

	next(): bigint {
		let state = this.state;
		state ^= state >> 12n;
		state = (state ^ (state << 25n)) & Seeded.MASK;
		state ^= state >> 27n;
		this.state = state;
		return (state * 0x2545f4914f6cdd1dn) & Seeded.MASK;
	}

	below(limit: number): number {
		return Number(this.next() % BigInt(limit));
	}

	pick<T>(from: readonly T[]): T {
		return from[this.below(from.length)] as T;
	}
}

const AGENTS = ['*', '*', 'googlebot', 'MyBot', '  *  ', 'Bot/1.0'] as const;

/**
 * Crawl-delay values chosen to separate `Number.parseFloat` from Rust's
 * `str::parse`: `Infinity` parses in both, `infinity` in only one, and a
 * trailing unit parses as its numeric prefix.
 */
const DELAYS = [
	'10',
	'0',
	'-1',
	'1.5',
	'1e3',
	'Infinity',
	'infinity',
	'nan',
	'abc',
	'',
	'10s',
	'0x10',
	'+5',
	'.5',
] as const;

/**
 * Patterns whose byte length and UTF-16 length differ, mixed with plain
 * ones and with the same paths spelled percent-encoded.
 *
 * Two things ride on these. RFC 9309 §2.2.2 has both sides of the
 * comparison percent-encoded first, so a rule and a path that name one
 * resource must answer the same however either is spelled — and the
 * length that longest-match-wins compares is the encoded form's octets,
 * which is why the raw pattern's byte-versus-UTF-16 count stopped being
 * part of the answer. A frontend that encodes one side, or measures the
 * wrong form, diverges here.
 */
function pattern(seeded: Seeded): string {
	switch (seeded.below(13)) {
		case 0:
			return '/';
		case 1:
			return `/section-${seeded.below(50)}`;
		case 2:
			return `/section-${seeded.below(50)}/*`;
		case 3:
			return `/assets-${seeded.below(50)}.json$`;
		case 4:
			return '/café';
		case 5:
			return '/ca*e';
		case 6:
			return `/*${seeded.below(50)}*`;
		case 7:
			return '$';
		case 8:
			return `/search?q=${seeded.below(50)}`;
		case 9:
			// The same path as case 4, already encoded — the rule and the
			// path must agree whichever spelling each one uses.
			return '/caf%C3%A9';
		case 10:
			// Lower-case hex: the canonical form upper-cases it, so a
			// frontend that skips that step matches nothing here.
			return '/caf%c3%a9';
		case 11:
			// A literal asterisk written the way §2.2.3 says to write it.
			// Encoding must not touch it, and must not encode the real
			// wildcards either.
			return '/wild-%2A-card';
		default:
			return `/path-${seeded.below(50)}`;
	}
}

function body(seeded: Seeded): string {
	const lines: string[] = [];
	const groups = 1 + seeded.below(4);
	for (let group = 0; group < groups; group++) {
		const agents = 1 + seeded.below(2);
		for (let agent = 0; agent < agents; agent++) {
			lines.push(`User-agent: ${seeded.pick(AGENTS)}`);
		}
		const rules = 1 + seeded.below(6);
		for (let rule = 0; rule < rules; rule++) {
			switch (seeded.below(7)) {
				case 0:
					lines.push(`Allow: ${pattern(seeded)}`);
					break;
				case 1:
					lines.push('# a comment');
					break;
				case 2:
					lines.push('');
					break;
				case 3:
					// A second crawl-delay in a second group: one runtime
					// keeps the first it finds and the other the last.
					lines.push(`Crawl-delay: ${seeded.pick(DELAYS)}`);
					break;
				case 4:
					lines.push(`Sitemap: https://example.com/sitemap-${seeded.below(20)}.xml`);
					break;
				case 5:
					lines.push('Disallow', 'Allow:');
					break;
				default:
					lines.push(`Disallow: ${pattern(seeded)}`);
					break;
			}
		}
	}
	const newline = seeded.below(4) === 0 ? '\r\n' : '\n';
	let content = lines.join(newline);
	if (seeded.below(2) === 0) {
		content += newline;
	}
	return content;
}

/**
 * The `path` argument. Anything carrying `://` routes through
 * `normalizeUrl` and `validateUrl` on both sides, which is how the URL
 * validator is reached without a network.
 */
function target(seeded: Seeded): string {
	switch (seeded.below(13)) {
		case 0:
			return '/';
		case 1:
			return `/section-${seeded.below(50)}/private`;
		case 2:
			return 'https://example.com/section-1/private';
		case 3:
			return 'http://user:pw@example.com:8080/a/b?c=1#d';
		case 4:
			return '://not a scheme';
		case 5:
			return 'ftp://example.com/x';
		case 6:
			return 'admin';
		case 7:
			return '/café/page';
		case 8:
			return `/assets-${seeded.below(50)}.json`;
		case 9:
			// The same resource as case 7, spelled the way a URL parser
			// hands it over. Before the encoding fix these two answered
			// differently on both servers alike.
			return '/caf%C3%A9/page';
		case 10:
			return '/caf%c3%a9/page';
		case 11:
			// A whole URL carrying non-ASCII: `URL.pathname` and
			// `Url::path()` must reduce it to the same encoded path.
			return 'https://example.com/café/page';
		default:
			return `/path-${seeded.below(50)}`;
	}
}

/**
 * Key order is not part of the contract — one side builds objects in
 * insertion order and the other in sorted order — so both answers are
 * canonicalised before the comparison. Everything else is compared byte
 * for byte.
 */
function canonical(value: unknown): string {
	const sort = (input: unknown): unknown => {
		if (Array.isArray(input)) return input.map(sort);
		if (input === null || typeof input !== 'object') return input;
		const entries = Object.entries(input as Record<string, unknown>)
			.filter(([, item]) => item !== undefined)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
		return Object.fromEntries(entries.map(([key, item]) => [key, sort(item)]));
	};
	return JSON.stringify(sort(value));
}

/** The Rust server, held open for the whole run. */
class CrateServer {
	private readonly child;
	private readonly pending: ((line: string) => void)[] = [];
	private readonly stderr: string[] = [];

	constructor() {
		this.child = spawn(BINARY, ['mcp'], { stdio: ['pipe', 'pipe', 'pipe'] });
		this.child.on('error', (error) => {
			console.error(
				`could not run ${BINARY}: ${error.message}\nBuild it first: cd crate && cargo build --locked`,
			);
			process.exit(1);
		});
		this.child.stderr?.on('data', (chunk) => this.stderr.push(String(chunk)));
		createInterface({ input: this.child.stdout }).on('line', (line) => {
			const resolve = this.pending.shift();
			if (resolve) resolve(line);
		});
	}

	call(args: Record<string, unknown>): Promise<unknown> {
		const request = {
			jsonrpc: '2.0',
			id: 1,
			method: 'tools/call',
			params: { name: 'analyze_robots_txt', arguments: args },
		};
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				reject(
					new Error(
						`the crate server did not answer in 30s${this.stderr.length ? `\n${this.stderr.join('')}` : ''}`,
					),
				);
			}, 30_000);
			this.pending.push((line) => {
				clearTimeout(timer);
				resolve(JSON.parse(line));
			});
			this.child.stdin?.write(`${JSON.stringify(request)}\n`);
		});
	}

	close(): void {
		this.child.stdin?.end();
		this.child.kill();
	}
}

const tool = TOOLS.find((candidate) => candidate.name === 'analyze_robots_txt');
if (!tool) {
	console.error('the extension no longer offers analyze_robots_txt');
	process.exit(1);
}

console.log(
	`differential: seed ${SEED}, ${CASES} cases, binary ${BINARY.replace(ROOT, '.')}`,
);

const seeded = new Seeded(SEED);
const server = new CrateServer();
let checked = 0;

for (let index = 0; index < CASES; index++) {
	const content = body(seeded);
	const path = target(seeded);
	const args = { content, path };

	const fromExtension = await tool.handler({ ...args });
	const response = (await server.call(args)) as {
		error?: { message: string };
		result?: { structuredContent?: unknown };
	};

	if (response.error) {
		server.close();
		console.error(
			`differential FAILED (seed ${SEED}, case ${index}): the crate server refused the call\n` +
				`  ${response.error.message}\n  path: ${JSON.stringify(path)}`,
		);
		process.exit(1);
	}

	const fromCrate = response.result?.structuredContent;
	if (canonical(fromExtension) !== canonical(fromCrate)) {
		server.close();
		console.error(
			`differential FAILED (seed ${SEED}, case ${index})\n\n` +
				'The two servers answered the same call differently. This is the SHARED\n' +
				'tool, so the difference is a bug in one of them — not an IDE-versus-\n' +
				'terminal surface difference, which would belong in crate/SPEC.md under\n' +
				'"Deliberate divergences".\n\n' +
				`  path: ${JSON.stringify(path)}\n\n` +
				`  robots.txt:\n${JSON.stringify(content)}\n\n` +
				`  extension: ${canonical(fromExtension)}\n\n` +
				`  crate:     ${canonical(fromCrate)}\n`,
		);
		process.exit(1);
	}
	checked++;
}

server.close();
console.log(
	`OK: ${checked} generated robots.txt documents, both servers byte-identical (seed ${SEED}).`,
);
