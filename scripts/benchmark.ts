/**
 * Measure real throughput. Run with `bun run benchmark`.
 *
 * Scrape-LE differs from its siblings: reachability and anti-bot checks drive
 * a real browser against a real site, so end-to-end timing measures the
 * network and the target server, not this code. Only the pure detection logic
 * is benchmarked here — signature matching over response headers and
 * robots.txt path matching — and the README says so plainly rather than
 * publishing a page-load figure that means nothing.
 *
 * Numbers are machine-specific and never asserted in CI.
 */
import { cpus, totalmem } from 'node:os';
import { ANTI_BOT_SIGNATURES, matchHeaders } from '../src/detectors/heuristics';
import { matchesRobotsPattern } from '../src/detectors/robotstxt';

interface Case {
	readonly label: string;
	readonly arg: string;
	readonly build: () => string;
}

// Header sets shaped like real responses from CDNs that front bot protection.
const HEADER_SETS = Array.from({ length: 20_000 }, (_, i) => ({
	server: i % 3 === 0 ? 'cloudflare' : 'nginx',
	'cf-ray': i % 3 === 0 ? `${i}-LHR` : '',
	'x-datadome': i % 7 === 0 ? 'protected' : '',
	'content-type': 'text/html; charset=utf-8',
	'cache-control': 'no-store',
	'x-request-id': `req-${i}`,
}));

const ROBOTS_PAIRS = Array.from({ length: 60_000 }, (_, i) => ({
	pattern: i % 4 === 0 ? '/private/*' : i % 4 === 1 ? '/api/*.json$' : `/p/${i % 50}/`,
	pathname: `/p/${i % 50}/item-${i}.html`,
}));

const CASES: readonly Case[] = [
	{
		label: 'Header signature scan',
		arg: 'headers',
		// Serialised only so the harness can report an input size.
		build: () => JSON.stringify(HEADER_SETS),
	},
	{
		label: 'robots.txt path match',
		arg: 'robots',
		build: () => JSON.stringify(ROBOTS_PAIRS),
	},
];

async function run(_content: string, c: Case): Promise<number> {
	if (c.arg === 'headers') {
		let hits = 0;
		for (const headers of HEADER_SETS) {
			for (const signature of ANTI_BOT_SIGNATURES) {
				if (matchHeaders(headers, signature) !== null) hits++;
			}
		}
		return HEADER_SETS.length;
	}
	let matched = 0;
	for (const p of ROBOTS_PAIRS) {
		if (matchesRobotsPattern(p.pattern, p.pathname)) matched++;
	}
	return ROBOTS_PAIRS.length;
}

const WARMUP = 2;
const RUNS = 7;

function median(xs: readonly number[]): number {
	const s = [...xs].sort((a, b) => a - b);
	const mid = Math.floor(s.length / 2);
	return s.length % 2
		? (s[mid] as number)
		: ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

async function main(): Promise<void> {
	const results: Array<Record<string, unknown>> = [];

	for (const c of CASES) {
		const content = c.build();
		const bytes = Buffer.byteLength(content, 'utf8');

		for (let i = 0; i < WARMUP; i++) await run(content, c);

		const durations: number[] = [];
		let count = 0;
		for (let i = 0; i < RUNS; i++) {
			const t0 = performance.now();
			count = await run(content, c);
			durations.push(performance.now() - t0);
		}

		const ms = median(durations);
		results.push({
			label: c.label,
			bytes,
			lines: content.split('\n').length,
			extracted: count,
			ms: Number(ms.toFixed(2)),
			perSecond: count > 0 ? Math.round(count / (ms / 1000)) : null,
			mbPerSecond: Number((bytes / 1_048_576 / (ms / 1000)).toFixed(1)),
		});
		console.log(
			`${c.label.padEnd(22)} ${(bytes / 1_048_576).toFixed(2)} MB  ${String(count).padStart(7)}  ${ms.toFixed(2)} ms`,
		);
	}

	const cpu = cpus()[0]?.model ?? 'unknown CPU';
	await Bun.write(
		'benchmark-results.json',
		`${JSON.stringify({ host: `${cpu}, ${Math.round(totalmem() / 1_073_741_824)} GB RAM, Node ${process.versions.node}`, runs: RUNS, results }, null, 2)}\n`,
	);
	console.log('\nwrote benchmark-results.json');
}

await main();
