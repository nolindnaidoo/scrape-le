/**
 * Evidence in, report out: `crate/src/detect/check.rs` with the detectors it
 * calls (`antibot.rs`, `ratelimit.rs`, `auth.rs`). Pure, as there: fetching and
 * rendering gather the evidence, this decides.
 *
 * Fields are built in the order the crate's structs declare them, because the
 * CLI prints a report in struct order. An `evidence` object is a
 * `serde_json::Value` in the crate, which sorts its keys, so each one here is
 * written with its keys already sorted.
 */
import { type Float, float } from './json';
import type { RobotsDocument } from './robots';
import type { Signature } from './signatures';
import { rustTrim } from './url';

export type Verdict = 'clear' | 'restricted' | 'blocked' | 'inconclusive';
export type Severity = 'blocks' | 'warns';
export type CheckStatus = 'ran' | 'partial' | 'skipped';

export type Finding = Readonly<{
	kind: string;
	severity: Severity;
	detail: string;
	evidence: unknown;
}>;

export type Checks = Readonly<{
	antibot: CheckStatus;
	rate_limit: CheckStatus;
	robots: CheckStatus;
	auth: CheckStatus;
}>;

export type RobotsReport = Readonly<{
	exists: boolean;
	allows_crawling: boolean;
	agent: string;
	crawl_delay?: Float | undefined;
	disallowed_paths: readonly string[];
	sitemaps: readonly string[];
}>;

export type Report = Readonly<{
	schema: 1;
	index?: number | undefined;
	url: string;
	final_url: string;
	status?: number | undefined;
	title?: string | undefined;
	verdict: Verdict;
	findings: readonly Finding[];
	checks: Checks;
	checks_skipped: readonly string[];
	robots?: RobotsReport | undefined;
	console_errors: readonly string[];
	screenshot?: string | undefined;
	/** Why a rendered check has no screenshot: the file and the OS's reason. */
	screenshot_error?: string | undefined;
	crawl_delay_ignored: boolean;
	timing_ms: Readonly<{
		fetch: number;
		render?: number | undefined;
		total: number;
	}>;
}>;

export type ProbeResult = Readonly<{
	script: string | undefined;
	selector: string | undefined;
	global: string | undefined;
}>;

export type AuthPageEvidence = Readonly<{
	hasPasswordInput: boolean;
	hasForm: boolean;
	hasUsernameInput: boolean;
	formAction: string | undefined;
	keyword: string | undefined;
}>;

export type RenderEvidence = Readonly<{
	finalUrl: string | undefined;
	title: string | undefined;
	bodyHtml: string;
	status: number | undefined;
	headers: ReadonlyMap<string, string> | undefined;
	probes: ReadonlyMap<string, ProbeResult>;
	auth: AuthPageEvidence;
	consoleErrors: readonly string[];
	screenshot: string | undefined;
	screenshotError: string | undefined;
	renderMs: number;
}>;

export type Evidence = {
	readonly url: string;
	readonly finalUrl: string;
	readonly status: number | undefined;
	/** lowercased names; a repeated header keeps its last value */
	readonly headers: ReadonlyMap<string, string>;
	readonly bodyHtml: string;
	readonly robots: RobotsDocument | undefined;
	readonly render: RenderEvidence | undefined;
	readonly fetchMs: number;
	totalMs: number;
};

export function evidenceFromRender(
	url: string,
	render: RenderEvidence,
	robots: RobotsDocument | undefined,
): Evidence {
	return {
		url,
		finalUrl: render.finalUrl ?? url,
		status: render.status,
		headers: render.headers ?? new Map(),
		bodyHtml: render.bodyHtml,
		robots,
		render,
		fetchMs: 0,
		totalMs: 0,
	};
}

export type CheckOptions = Readonly<{
	agent: string | undefined;
	index: number | undefined;
	ignoreCrawlDelay: boolean;
}>;

export function check(
	evidence: Evidence,
	options: CheckOptions,
	signatures: readonly Signature[],
): Report {
	const findings: Finding[] = [];
	checkAntibot(evidence, signatures, findings);
	checkRateLimit(evidence, findings);
	const robots = checkRobots(evidence, options, findings);
	checkAuth(evidence, findings);

	const render = evidence.render;
	const dom: CheckStatus = render ? 'ran' : 'partial';
	const checks: Checks = Object.freeze({
		antibot: dom,
		rate_limit: 'ran',
		robots: robots.status,
		auth: dom,
	});
	const skipped = (Object.entries(checks) as [string, CheckStatus][])
		.filter(([, status]) => status !== 'ran')
		.map(([name]) => name);

	return Object.freeze({
		schema: 1,
		index: options.index,
		url: evidence.url,
		final_url: render?.finalUrl ?? evidence.finalUrl,
		status: evidence.status,
		title: render?.title ?? extractTitle(evidence.bodyHtml),
		verdict: decide(findings, skipped),
		findings,
		checks,
		checks_skipped: skipped,
		robots: robots.report,
		console_errors: render?.consoleErrors ?? [],
		screenshot: render?.screenshot,
		screenshot_error: render?.screenshotError,
		crawl_delay_ignored: options.ignoreCrawlDelay,
		timing_ms: {
			fetch: evidence.fetchMs,
			render: render?.renderMs,
			total: evidence.totalMs,
		},
	});
}

/** A report for a page that could not be fetched at all. */
export function blockedReport(
	url: string,
	reason: string,
	index: number | undefined,
	crawlDelayIgnored: boolean,
): Report {
	const report: Report = {
		schema: 1,
		index,
		url,
		final_url: url,
		verdict: 'blocked',
		findings: [
			{ kind: 'fetch', severity: 'blocks', detail: reason, evidence: null },
		],
		checks: {
			antibot: 'skipped',
			rate_limit: 'skipped',
			robots: 'skipped',
			auth: 'skipped',
		},
		checks_skipped: ['antibot', 'rate_limit', 'robots', 'auth'],
		console_errors: [],
		crawl_delay_ignored: crawlDelayIgnored,
		timing_ms: { fetch: 0, total: 0 },
	};
	return Object.freeze(report);
}

/** `match_headers`: the first header of the signature that fits. */
export function matchHeaders(
	headers: ReadonlyMap<string, string>,
	signature: Signature,
): { header: string; detail: string } | undefined {
	for (const header of signature.headers) {
		const value = headers.get(header.name);
		if (value === undefined || value === '') continue;
		const matched = {
			header: header.name,
			detail: `${signature.label} (${header.name} header)`,
		};
		if (header.contains === undefined) return matched;
		if (value.toLowerCase().includes(header.contains)) return matched;
	}
	return undefined;
}

function checkAntibot(
	evidence: Evidence,
	signatures: readonly Signature[],
	findings: Finding[],
): void {
	const detected: string[] = [];
	for (const signature of signatures) {
		const matched = matchHeaders(evidence.headers, signature);
		if (!matched) continue;
		detected.push(signature.key);
		findings.push({
			kind: 'antibot',
			severity: 'warns',
			detail: matched.detail,
			evidence: { signal: matched.header, source: 'response-header' },
		});
	}
	const render = evidence.render;
	if (!render) return;
	for (const signature of signatures) {
		if (detected.includes(signature.key)) continue;
		const probe = render.probes.get(signature.key);
		if (!probe) continue;
		const found = firstSignal(probe);
		if (!found) continue;
		findings.push({
			kind: 'antibot',
			severity: 'warns',
			detail: `${signature.label} (${found.how})`,
			evidence: { signal: found.signal, source: found.source },
		});
	}
}

function firstSignal(
	probe: ProbeResult,
): { signal: string; how: string; source: string } | undefined {
	if (probe.script !== undefined) {
		return { signal: probe.script, how: 'script src', source: 'script-src' };
	}
	if (probe.selector !== undefined) {
		return {
			signal: probe.selector,
			how: 'DOM element',
			source: 'dom-element',
		};
	}
	if (probe.global !== undefined) {
		return {
			signal: probe.global,
			how: 'window global',
			source: 'window-global',
		};
	}
	return undefined;
}

function checkRateLimit(evidence: Evidence, findings: Finding[]): void {
	const headers = evidence.headers;
	const nonEmpty = (name: string): string | undefined => {
		const value = headers.get(name);
		return value === undefined || value === '' ? undefined : value;
	};
	const limit = nonEmpty('x-ratelimit-limit') ?? nonEmpty('ratelimit-limit');
	const remaining =
		nonEmpty('x-ratelimit-remaining') ?? nonEmpty('ratelimit-remaining');
	const reset = nonEmpty('x-ratelimit-reset') ?? nonEmpty('ratelimit-reset');
	const retryAfter = nonEmpty('retry-after');
	const limited = evidence.status === 429;
	const advertised =
		limit !== undefined ||
		remaining !== undefined ||
		reset !== undefined ||
		retryAfter !== undefined;
	if (!advertised && !limited) return;
	findings.push({
		kind: 'rate_limit',
		severity: limited ? 'blocks' : 'warns',
		detail: limited
			? 'HTTP 429: rate limited right now'
			: 'Rate-limit headers advertised',
		evidence: {
			limit: limit ?? null,
			remaining: remaining ?? null,
			reset: reset ?? null,
			retry_after: retryAfter ?? null,
			status: evidence.status ?? null,
		},
	});
}

function checkRobots(
	evidence: Evidence,
	options: CheckOptions,
	findings: Finding[],
): { status: CheckStatus; report: RobotsReport | undefined } {
	const document = evidence.robots;
	if (!document) {
		return {
			status: 'ran',
			report: {
				exists: false,
				allows_crawling: true,
				agent: options.agent ?? '*',
				disallowed_paths: [],
				sitemaps: [],
			},
		};
	}
	let pathname: string;
	try {
		pathname = new URL(evidence.url).pathname;
	} catch {
		return { status: 'skipped', report: undefined };
	}
	const info = document.evaluate(pathname, options.agent);
	const report: RobotsReport = {
		exists: info.exists,
		allows_crawling: info.allowsCrawling,
		agent: info.agent,
		crawl_delay:
			info.crawlDelay === undefined ? undefined : float(info.crawlDelay),
		disallowed_paths: info.disallowedPaths,
		sitemaps: info.sitemaps,
	};
	if (info.allowsCrawling) return { status: 'ran', report };
	if (document.unreachable) {
		findings.push({
			kind: 'robots',
			severity: 'blocks',
			detail:
				'robots.txt could not be read; assuming complete disallow (RFC 9309 §2.3.1.4)',
			evidence: { agent: info.agent, source: 'robots.txt' },
		});
		return { status: 'ran', report };
	}
	const rule = info.matchedRule ?? '';
	findings.push({
		kind: 'robots',
		severity: 'blocks',
		detail: `Disallow: ${rule} for User-agent: ${info.agent}`,
		evidence: { agent: info.agent, rule: `Disallow: ${rule}` },
	});
	return { status: 'ran', report };
}

const AUTH_SEGMENTS: readonly string[] = Object.freeze([
	'login',
	'signin',
	'sign-in',
	'auth',
	'authenticate',
]);

/** One strong signal (401/403, a password field) or two weak ones. */
function checkAuth(evidence: Evidence, findings: Finding[]): void {
	const finalUrl = evidence.render?.finalUrl ?? evidence.finalUrl;
	const page = evidence.render?.auth;
	const indicators: string[] = [];

	let strongStatus = false;
	if (evidence.status === 401) {
		indicators.push('HTTP 401 Unauthorized');
		strongStatus = true;
	}
	if (evidence.status === 403) {
		indicators.push('HTTP 403 Forbidden');
		strongStatus = true;
	}

	let form = false;
	let authType: string | undefined;
	let loginUrl: string | undefined;
	if (page?.hasPasswordInput) {
		form = true;
		authType = 'form';
		if (page.hasForm) {
			indicators.push('Login form detected (username + password fields)');
			loginUrl = page.formAction;
		}
		if (!page.hasForm) indicators.push('Password input detected');
	}

	const keyword = page?.keyword;
	if (keyword !== undefined) {
		indicators.push(`Authentication keyword: "${keyword}"`);
	}
	const segment = authSegment(finalUrl);
	if (segment !== undefined) {
		indicators.push(`URL contains auth path segment: /${segment}`);
	}

	const required =
		strongStatus ||
		form ||
		(indicators.length >= 2 &&
			(keyword !== undefined || segment !== undefined));
	if (!required) return;
	findings.push({
		kind: 'auth',
		severity: 'blocks',
		detail: 'Authentication required',
		evidence: {
			indicators,
			login_url: loginUrl ?? null,
			paired_username: page?.hasUsernameInput ?? false,
			type: authType ?? null,
		},
	});
}

/** Whole path segments, so `/author/jane` is not `auth`. */
function authSegment(finalUrl: string): string | undefined {
	let pathname: string;
	try {
		pathname = new URL(finalUrl).pathname.toLowerCase();
	} catch {
		return undefined;
	}
	return pathname
		.split('/')
		.filter((segment) => segment !== '')
		.find((segment) => AUTH_SEGMENTS.includes(segment));
}

/** `clear` requires completeness; `restricted` does not. */
function decide(
	findings: readonly Finding[],
	skipped: readonly string[],
): Verdict {
	if (findings.length > 0) return 'restricted';
	if (skipped.length === 0) return 'clear';
	return 'inconclusive';
}

/**
 * The raw-HTML `<title>`, when no render read one. Tag names are found in an
 * ASCII-lowercased copy, which keeps every offset where it was.
 */
export function extractTitle(html: string): string | undefined {
	const lower = html.replace(/[A-Z]+/g, (letters) => letters.toLowerCase());
	const open = lower.indexOf('<title');
	if (open === -1) return undefined;
	const gt = lower.indexOf('>', open);
	if (gt === -1) return undefined;
	const close = lower.indexOf('</title>', gt + 1);
	if (close === -1) return undefined;
	const title = rustTrim(html.slice(gt + 1, close));
	return title === '' ? undefined : title;
}
