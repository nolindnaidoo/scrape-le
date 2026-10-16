/**
 * Batch input and scheduling: `crate/src/batch.rs`. One rule generates the
 * design: never two concurrent requests to the same host. Hosts run in
 * parallel, the URLs of one host run in turn, and a declared `Crawl-delay` is
 * waited out between them.
 */
import type { Report } from './report';
import { rustTrim, rustTrimStart } from './url';

export const DEFAULT_CONCURRENCY = 4;

/** Five minutes: a delay is a third party's input, and two legal values hung the run. */
const MAX_CRAWL_DELAY_MS = 300_000;

export type Target = Readonly<{ index: number; url: string }>;

/** How long to wait after a request to a host that declared this delay. */
export function waitFor(seconds: number): number | undefined {
	if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
	if (seconds >= MAX_CRAWL_DELAY_MS / 1000) return MAX_CRAWL_DELAY_MS;
	return seconds * 1000;
}

/** A JSON array, a CSV with a `url` column or one URL per line, by content. */
export function parseInput(raw: string): string[] {
	const text = raw.startsWith('﻿') ? raw.slice(1) : raw;
	const trimmed = rustTrimStart(text);
	if (trimmed.startsWith('[')) return parseJsonArray(trimmed);
	return parseLines(text);
}

function parseJsonArray(raw: string): string[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		throw new Error(`input is not valid JSON: ${serdeJsonError(raw, error)}`);
	}
	if (!Array.isArray(parsed)) throw new Error('JSON input must be an array');
	return parsed.map((item, position) => {
		if (typeof item === 'string') return item;
		if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
			const url = (item as Record<string, unknown>).url;
			if (typeof url !== 'string') {
				throw new Error(`entry ${position} has no \`url\` key`);
			}
			return url;
		}
		throw new Error(`entry ${position} is neither a string nor an object`);
	});
}

/**
 * serde_json names a syntax error by what it found and where, `at line L
 * column C`. Node's parser names the same failure in its own words, so only
 * the position is recovered here; the parity harness compares the prefix.
 */
function serdeJsonError(raw: string, error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	const position = /position (\d+)/.exec(message);
	if (!position) return message;
	const offset = Number(position[1]);
	const before = raw.slice(0, offset + 1);
	const line = before.split('\n').length;
	const column = offset + 1 - (before.lastIndexOf('\n') + 1);
	return `${message.replace(/ in JSON at position \d+.*$/, '')} at line ${line} column ${column}`;
}

/** A `url` header picks its column; otherwise each line is a URL. */
function parseLines(raw: string): string[] {
	const lines = raw
		.split('\n')
		.map((line) => rustTrim(line.endsWith('\r') ? line.slice(0, -1) : line))
		.filter((line) => line !== '' && !line.startsWith('#'));
	const first = lines[0];
	if (first === undefined) return [];
	const header = first
		.split(',')
		.map((column) => rustTrim(column).toLowerCase());
	const urlColumn = header.indexOf('url');
	const body = urlColumn === -1 ? lines : lines.slice(1);
	const column = urlColumn === -1 ? 0 : urlColumn;
	return body.flatMap((line) => {
		const field = line.split(',')[column];
		if (field === undefined) return [];
		const value = rustTrim(field);
		return value === '' ? [] : [value.replace(/^"+|"+$/g, '')];
	});
}

/**
 * Groups by host in input order. A URL that will not parse keeps a bucket of
 * its own under its raw text, so it still runs and still reports.
 */
export function groupByHost(targets: readonly Target[]): Target[][] {
	const hosts = new Map<string, Target[]>();
	for (const target of targets) {
		const host = hostOf(target.url) ?? target.url;
		const bucket = hosts.get(host);
		if (bucket) {
			bucket.push(target);
			continue;
		}
		hosts.set(host, [target]);
	}
	return [...hosts.values()];
}

function hostOf(url: string): string | undefined {
	try {
		const parsed = new URL(url);
		return parsed.hostname === '' ? undefined : parsed.hostname.toLowerCase();
	} catch {
		return undefined;
	}
}

export type Summary = {
	clear: number;
	restricted: number;
	blocked: number;
	inconclusive: number;
};

export function total(summary: Summary): number {
	return (
		summary.clear + summary.restricted + summary.blocked + summary.inconclusive
	);
}

export function worstIsClear(summary: Summary): boolean {
	return (
		summary.restricted === 0 &&
		summary.blocked === 0 &&
		summary.inconclusive === 0 &&
		summary.clear > 0
	);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs the batch, handing each report to `emit` as it completes. Workers take
 * host groups from the end of the list, as the crate's `Vec::pop` does, so a
 * run of one worker visits the hosts in the same order.
 */
export async function runBatch(
	targets: readonly Target[],
	options: Readonly<{ concurrency: number; ignoreCrawlDelay: boolean }>,
	checkOne: (target: Target) => Promise<Report>,
	emit: (report: Report) => void,
): Promise<Summary> {
	const queue = groupByHost(targets);
	const workers = Math.min(
		Math.max(options.concurrency, 1),
		Math.max(queue.length, 1),
	);
	const seen = new Map<string, Report>();
	const summary: Summary = {
		clear: 0,
		restricted: 0,
		blocked: 0,
		inconclusive: 0,
	};

	const record = (report: Report): void => {
		summary[report.verdict] += 1;
		emit(report);
	};

	const worker = async (): Promise<void> => {
		while (true) {
			const group = queue.pop();
			if (!group) return;
			let delay: number | undefined;
			for (const target of group) {
				if (delay !== undefined && !options.ignoreCrawlDelay)
					await sleep(delay);
				delay = undefined;
				const cached = seen.get(target.url);
				const report: Report = cached
					? Object.freeze({ ...cached, index: target.index })
					: await checkOne(target);
				if (!cached) seen.set(target.url, report);
				const declared = report.robots?.crawl_delay?.float;
				delay = declared === undefined ? undefined : waitFor(declared);
				record(report);
			}
		}
	};
	await Promise.all(Array.from({ length: workers }, () => worker()));
	return summary;
}
