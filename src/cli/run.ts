/**
 * The terminal surface: `crate/src/cli.rs`. stdout carries one JSON report per
 * URL when something reads it and nothing at a terminal; stderr is the human
 * summary of the same reports. 0 `clear`, 1 not a yes, 2 a malformed question.
 */
import { readFileSync, statSync } from 'node:fs';
import {
	DEFAULT_CONCURRENCY,
	groupByHost,
	parseInput,
	runBatch,
	total,
	worstIsClear,
} from './batch';
import { findBrowser } from './browser';
import {
	type CheckOutcome,
	type Context,
	checkUrl,
	type Options,
} from './checkUrl';
import { createRobotsCache } from './fetch';
import { decodeUtf8OrThrow, rustIoMessage } from './ioError';
import { rustFloatDisplay, toJson } from './json';
import { blockedReport, type Report } from './report';
import { BUILT_IN, loadExtra, merge, type Signature } from './signatures';
import { targetInText, targetUrl } from './url';
import { USAGE } from './usage';

export type Io = Readonly<{
	stdout: (text: string) => void;
	stderr: (text: string) => void;
	stdoutIsTerminal: boolean;
	readStdin: () => Uint8Array;
	version: string;
}>;

type Parsed = Readonly<{
	options: Options;
	urls: readonly string[];
	input: string | undefined;
	signatures: readonly Signature[];
}>;

type Exit =
	| Readonly<{ kind: 'message'; text: string }>
	| Readonly<{ kind: 'error'; text: string }>;

export function parseArgs(
	args: readonly string[],
	io: Pick<Io, 'stderr' | 'version'>,
): Parsed | Exit {
	let noRender = false;
	let ignoreCrawlDelay = false;
	let agent: string | undefined;
	let concurrency = DEFAULT_CONCURRENCY;
	let input: string | undefined;
	let signaturesPath: string | undefined;
	const urls: string[] = [];

	for (let i = 0; i < args.length; i += 1) {
		const arg = args[i] as string;
		const value = (flag: string): string | Exit => {
			i += 1;
			const next = args[i];
			return next === undefined
				? { kind: 'error', text: `${flag} needs a value` }
				: next;
		};
		if (arg === '--help' || arg === '-h')
			return { kind: 'message', text: USAGE };
		if (arg === '--version' || arg === '-V') {
			return { kind: 'message', text: `scrape-le ${io.version}` };
		}
		if (arg === '--no-render') {
			noRender = true;
			continue;
		}
		if (arg === '--ignore-crawl-delay') {
			ignoreCrawlDelay = true;
			continue;
		}
		if (arg === '--agent' || arg === '--signatures' || arg === '--input') {
			const taken = value(arg);
			if (typeof taken !== 'string') return taken;
			if (arg === '--agent') agent = taken;
			if (arg === '--signatures') signaturesPath = taken;
			if (arg === '--input') input = taken;
			continue;
		}
		if (arg === '--concurrency') {
			const raw = value(arg);
			if (typeof raw !== 'string') return raw;
			// `usize::from_str`: digits with an optional `+`, nothing else.
			if (!/^\+?[0-9]+$/.test(raw) || BigInt(raw) > 18446744073709551615n) {
				return {
					kind: 'error',
					text: `--concurrency needs a number, got ${raw}`,
				};
			}
			const parsed = Number(raw);
			if (parsed === 0)
				return { kind: 'error', text: '--concurrency must be at least 1' };
			concurrency = parsed;
			continue;
		}
		if (arg.startsWith('-') && arg !== '-') {
			return { kind: 'error', text: `unknown flag ${arg}\n\n${USAGE}` };
		}
		urls.push(arg);
	}

	let signatures: readonly Signature[] = BUILT_IN;
	if (signaturesPath !== undefined) {
		const loaded = loadExtra(signaturesPath);
		if (!loaded.ok) return { kind: 'error', text: loaded.message };
		signatures = merge(BUILT_IN, loaded.signatures);
		io.stderr(
			`scrape-le: loaded ${loaded.signatures.length} signature(s) from ${signaturesPath}\n`,
		);
	}

	return {
		options: { noRender, agent, concurrency, ignoreCrawlDelay },
		urls,
		input,
		signatures,
	};
}

export async function run(args: readonly string[], io: Io): Promise<number> {
	const parsed = parseArgs(args, io);
	if ('kind' in parsed && parsed.kind === 'message') {
		io.stdout(`${parsed.text}\n`);
		return 0;
	}
	if ('kind' in parsed) {
		io.stderr(`scrape-le: ${parsed.text}\n`);
		return 2;
	}
	const context: Context = {
		version: io.version,
		signatures: parsed.signatures,
		stderr: io.stderr,
	};
	if (parsed.input !== undefined) {
		return runFromInput(parsed.input, parsed.options, context, io);
	}
	const [first, ...rest] = parsed.urls;
	if (first === undefined) {
		io.stderr(`${USAGE}\n`);
		return 2;
	}
	if (rest.length === 0) return runSingle(first, parsed.options, context, io);
	return runTargets(
		parsed.urls.map((url, index) => ({ index, url })),
		parsed.options,
		context,
		io,
	);
}

async function runSingle(
	raw: string,
	options: Options,
	context: Context,
	io: Io,
): Promise<number> {
	const url = targetUrl(raw);
	if (url === undefined) {
		io.stderr(`scrape-le: not an http(s) URL: ${raw}\n`);
		return 2;
	}
	const outcome: CheckOutcome = await checkUrl(
		url,
		undefined,
		options,
		createRobotsCache(io.version),
		context,
	);
	if (outcome.kind === 'malformed') {
		io.stderr(`scrape-le: ${outcome.reason}\n`);
		return 2;
	}
	emit(outcome.report, io);
	io.stderr(human(outcome.report));
	return outcome.report.verdict === 'clear' ? 0 : 1;
}

async function runFromInput(
	source: string,
	options: Options,
	context: Context,
	io: Io,
): Promise<number> {
	const raw = readInput(source, io);
	if (!raw.ok) {
		io.stderr(`scrape-le: ${raw.message}\n`);
		return 2;
	}
	let urls: string[];
	try {
		urls = parseInput(raw.text);
	} catch (error) {
		io.stderr(`scrape-le: ${(error as Error).message}\n`);
		return 2;
	}
	if (urls.length === 0) {
		io.stderr(`scrape-le: no URLs in ${source}\n`);
		return 2;
	}
	const targets: { index: number; url: string }[] = [];
	let malformed = 0;
	urls.forEach((entry, index) => {
		const url = targetInText(entry);
		if (url === undefined) {
			io.stderr(`scrape-le: entry ${index} is not an http(s) URL: ${entry}\n`);
			malformed += 1;
			return;
		}
		targets.push({ index, url });
	});
	if (targets.length === 0) return 2;
	const code = await runTargets(targets, options, context, io);
	// 2 outranks every verdict: the input was broken whatever the URLs said.
	return malformed > 0 ? 2 : code;
}

async function runTargets(
	targets: readonly { index: number; url: string }[],
	options: Options,
	context: Context,
	io: Io,
): Promise<number> {
	const started = Date.now();
	const hosts = groupByHost(targets).length;
	const robots = createRobotsCache(io.version);
	let malformed = 0;
	const summary = await runBatch(
		targets,
		{
			concurrency: options.concurrency,
			ignoreCrawlDelay: options.ignoreCrawlDelay,
		},
		async (target): Promise<Report> => {
			const outcome = await checkUrl(
				target.url,
				target.index,
				options,
				robots,
				context,
			);
			if (outcome.kind === 'report') return outcome.report;
			io.stderr(`scrape-le: entry ${target.index}: ${outcome.reason}\n`);
			malformed += 1;
			return blockedReport(
				target.url,
				outcome.reason,
				target.index,
				options.ignoreCrawlDelay,
			);
		},
		(report) => {
			emit(report, io);
			io.stderr(human(report));
		},
	);
	io.stderr(
		`\n${summary.clear} clear · ${summary.restricted} restricted · ${summary.blocked} blocked · ${summary.inconclusive} inconclusive\n`,
	);
	io.stderr(
		`${total(summary)} URLs across ${hosts} host(s) in ${((Date.now() - started) / 1000).toFixed(1)}s\n`,
	);
	if (options.ignoreCrawlDelay) {
		io.stderr('declared Crawl-delay not waited for (--ignore-crawl-delay)\n');
	}
	if (options.noRender) {
		io.stderr(
			'verdicts cannot be `clear` until every check runs fully (--no-render)\n',
		);
	}
	if (malformed > 0) return 2;
	return worstIsClear(summary) ? 0 : 1;
}

function readInput(
	source: string,
	io: Io,
): { ok: true; text: string } | { ok: false; message: string } {
	if (source === '-') {
		try {
			return { ok: true, text: decodeUtf8OrThrow(io.readStdin()) };
		} catch (error) {
			return {
				ok: false,
				message: `could not read stdin: ${rustIoMessage(error)}`,
			};
		}
	}
	// A named pipe with no writer never finishes a read, so only a regular file
	// is read at all.
	try {
		if (!statSync(source).isFile()) {
			return {
				ok: false,
				message: `could not read ${source}: not a regular file`,
			};
		}
		return { ok: true, text: decodeUtf8OrThrow(readFileSync(source)) };
	} catch (error) {
		return {
			ok: false,
			message: `could not read ${source}: ${rustIoMessage(error)}`,
		};
	}
}

/** Answered up front rather than at the end of a failed check. */
export function doctor(io: Pick<Io, 'stdout'>): number {
	const browser = findBrowser();
	if (browser.ok) {
		io.stdout(`browser: ${browser.path}\n`);
		io.stdout(
			'render:  available — every check can run, `clear` is reachable\n',
		);
		io.stdout('http:    available — robots.txt, status, headers, redirects\n');
		return 0;
	}
	io.stdout('browser: not found\n');
	io.stdout(`render:  unavailable — ${browser.reason}\n`);
	io.stdout(
		'http:    available — robots.txt, status, headers and redirects still answer,\n         but anti-bot and authentication run partially and the verdict\n         can never be `clear`\n',
	);
	return 1;
}

/** Nothing at a terminal, where the summary on stderr already says it. */
function emit(report: Report, io: Io): void {
	if (io.stdoutIsTerminal) return;
	io.stdout(`${toJson(report, { sorted: false })}\n`);
}

const CHECK_MARK: Readonly<Record<string, string>> = Object.freeze({
	ran: '✓',
	partial: 'partial (no render)',
	skipped: 'skipped',
});

/** The human projection of one report, written as one piece. */
export function human(report: Report): string {
	const count = report.findings.length;
	const noun = count === 1 ? 'finding' : 'findings';
	const position = report.index === undefined ? '' : `[${report.index}] `;
	const lines = [
		'',
		`${position}${report.verdict} — ${count} ${noun}  (${report.final_url} · ${report.timing_ms.total}ms · exit ${report.verdict === 'clear' ? 0 : 1})`,
	];
	for (const finding of report.findings) {
		const severity = finding.severity === 'blocks' ? 'blocks' : 'warns ';
		lines.push(
			`  ${severity}  ${padChars(finding.kind, 10)} ${finding.detail}`,
		);
	}
	const delay = report.robots?.crawl_delay;
	if (report.robots && delay !== undefined) {
		lines.push(
			`  robots  Crawl-delay: ${rustFloatDisplay(delay.float)}s (User-agent: ${report.robots.agent})`,
		);
	}
	if (report.crawl_delay_ignored && report.index === undefined) {
		lines.push(
			'  robots  declared Crawl-delay not waited for (--ignore-crawl-delay)',
		);
	}
	if (report.screenshot !== undefined)
		lines.push(`  shot    ${report.screenshot}`);
	if (report.screenshot_error !== undefined)
		lines.push(`  shot    could not be written: ${report.screenshot_error}`);
	const checks = [
		['antibot', report.checks.antibot],
		['rate-limit', report.checks.rate_limit],
		['robots', report.checks.robots],
		['auth', report.checks.auth],
	]
		.map(([name, status]) => `${name} ${CHECK_MARK[status as string]}`)
		.join('  ·  ');
	lines.push(`  checks  ${checks}`);
	if (report.checks_skipped.length > 0 && report.index === undefined) {
		lines.push(
			'  note    verdict cannot be `clear` until every check runs fully',
		);
	}
	return `${lines.join('\n')}\n`;
}

/** `{:<10}` pads by characters, not UTF-16 units. */
function padChars(text: string, width: number): string {
	const length = [...text].length;
	return length >= width ? text : `${text}${' '.repeat(width - length)}`;
}
