/**
 * One URL end to end: `crate/src/check_url.rs`. Both surfaces call this, so
 * neither can answer the same URL differently.
 */
import { findBrowser } from './browser';
import { fetchEvidence, type RobotsCache } from './fetch';
import { render } from './render';
import {
	blockedReport,
	check,
	type Evidence,
	evidenceFromRender,
	type Report,
} from './report';
import type { Signature } from './signatures';

export type Options = Readonly<{
	noRender: boolean;
	agent: string | undefined;
	concurrency: number;
	ignoreCrawlDelay: boolean;
}>;

export type Context = Readonly<{
	version: string;
	signatures: readonly Signature[];
	stderr: (text: string) => void;
}>;

export type CheckOutcome =
	| Readonly<{ kind: 'report'; report: Report }>
	| Readonly<{ kind: 'malformed'; reason: string }>;

export async function checkUrl(
	url: string,
	index: number | undefined,
	options: Options,
	robots: RobotsCache,
	context: Context,
): Promise<CheckOutcome> {
	const started = Date.now();
	let evidence: Evidence | undefined = await renderEvidence(
		url,
		options,
		robots,
		context,
	);
	if (evidence === undefined) {
		const fetched = await fetchEvidence(url, robots, context.version);
		if (!fetched.ok && fetched.error.kind === 'malformed') {
			return { kind: 'malformed', reason: fetched.error.reason };
		}
		if (!fetched.ok) {
			return {
				kind: 'report',
				report: blockedReport(
					url,
					fetched.error.reason,
					index,
					options.ignoreCrawlDelay,
				),
			};
		}
		evidence = fetched.evidence;
	}
	evidence.totalMs = Date.now() - started;
	return {
		kind: 'report',
		report: check(
			evidence,
			{
				agent: options.agent,
				index,
				ignoreCrawlDelay: options.ignoreCrawlDelay,
			},
			context.signatures,
		),
	};
}

/**
 * Best effort: no browser, or a render that fails, falls back to HTTP with
 * the reason on stderr rather than a silent over-claim.
 */
async function renderEvidence(
	url: string,
	options: Options,
	robots: RobotsCache,
	context: Context,
): Promise<Evidence | undefined> {
	if (options.noRender) return undefined;
	const browser = findBrowser();
	if (!browser.ok) {
		context.stderr(`scrape-le: render unavailable — ${browser.reason}\n`);
		return undefined;
	}
	try {
		const rendered = await render(url, browser.path, context.signatures);
		return evidenceFromRender(url, rendered, await robots.document(url));
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		context.stderr(
			`scrape-le: render failed — ${reason}; falling back to HTTP evidence\n`,
		);
		return undefined;
	}
}
