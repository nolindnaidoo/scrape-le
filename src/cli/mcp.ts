/**
 * `scrape-le mcp`: the crate's MCP server (`crate/src/mcp/`), not the
 * extension's. The npm `scrape-le-mcp` offers `analyze_robots_txt` alone; this
 * one adds `scrape_le_check` and `scrape_le_doctor`, answers in the crate's
 * words, and serializes the way serde_json does, keys sorted. The protocol
 * around the tools refuses a malformed frame in the extension server's
 * words, so a client cannot tell the three servers apart by what it sent.
 */
import { DEFAULT_CONCURRENCY } from './batch';
import { findBrowser } from './browser';
import { type Context, checkUrl } from './checkUrl';
import { createRobotsCache } from './fetch';
import { frames, type Request } from './frames';
import { type Float, float, toJson } from './json';
import { parseRobots } from './robots';
import { normalizeUrl, rustTrim, targetUrl, validateUrl } from './url';

const PROTOCOL_VERSION = '2025-06-18';
const PARSE_ERROR = -32700;
const INVALID_PARAMS = -32602;
const METHOD_NOT_FOUND = -32601;
const DEFAULT_MAX_RESULTS = 500;
const MAX_MAX_RESULTS = 5000;

type Json = unknown;
type Handled = { result: Json } | { error: { code: number; message: string } };

const ANALYZE_DEFINITION = Object.freeze({
	name: 'analyze_robots_txt',
	description:
		'Given the contents of a robots.txt file and a path, report whether the rules permit crawling it — the group naming `agent` when one does, otherwise the generic (User-agent: *) rules, and `agent` in the answer says which — along with the crawl delay, the disallowed patterns and any sitemaps. Takes the file contents directly and makes no network request of its own — fetch robots.txt with your own HTTP tool and pass what it returned.',
	inputSchema: {
		type: 'object',
		properties: {
			content: {
				type: 'string',
				description: 'The contents of the robots.txt file.',
			},
			path: {
				type: 'string',
				description:
					'The path to check, e.g. "/admin". A full URL is accepted and reduced to its path.',
			},
			agent: {
				type: 'string',
				description:
					'The crawler to evaluate as, e.g. "Googlebot" or "MyBot/1.0"; matched on its product token, case-insensitively. Omitted, the generic rules answer.',
			},
			maxResults: {
				type: 'integer',
				minimum: 1,
				maximum: MAX_MAX_RESULTS,
				default: DEFAULT_MAX_RESULTS,
				description: `Cap on returned disallowed paths (default ${DEFAULT_MAX_RESULTS}). meta.truncated reports whether any were dropped.`,
			},
		},
		required: ['content', 'path'],
		additionalProperties: false,
	},
});

const TOOL_DEFINITIONS = Object.freeze([
	ANALYZE_DEFINITION,
	{
		name: 'scrape_le_check',
		description:
			'Check whether a page can be scraped: robots.txt, anti-bot vendors, rate limits and authentication walls. Accepts one URL or several. A restricted or inconclusive answer is a normal result, not an error.',
		inputSchema: {
			type: 'object',
			properties: {
				url: { type: 'string', description: 'the URL to check' },
				urls: {
					type: 'array',
					items: { type: 'string' },
					description: 'several URLs to check, instead of `url`',
				},
				render: {
					type: 'boolean',
					description:
						'load the page in a browser (default true). Without it, anti-bot and authentication checks run partially and the verdict can never be `clear`.',
				},
				agent: {
					type: 'string',
					description:
						'evaluate robots.txt as this crawler token; the generic rules are used when omitted',
				},
			},
		},
	},
	{
		name: 'scrape_le_doctor',
		description:
			'Report whether a browser is available, which one, and which checks can run completely.',
		inputSchema: { type: 'object', properties: {} },
	},
]);

/**
 * Serves until stdin closes, one request at a time, in order, over the
 * crate's framing in `frames.ts`. A frame the framing refuses is answered
 * with a parse error, as the crate answers it. `write` answers with a
 * promise when the pipe is full, and the next frame waits on it, as the
 * crate's blocking write waits: a client that reads slowly holds its
 * replies in the pipe, not in this process.
 */
export async function serve(
	context: Context,
	input: AsyncIterable<Uint8Array>,
	write: (line: string) => Promise<void> | undefined,
): Promise<number> {
	for await (const frame of frames(input)) {
		if ('refusal' in frame) {
			await write(
				`${toJson({ jsonrpc: '2.0', id: null, error: { code: PARSE_ERROR, message: frame.refusal } }, { sorted: true })}\n`,
			);
			continue;
		}
		const response = await handle(frame.request, context);
		if (response !== undefined)
			await write(`${toJson(response, { sorted: true })}\n`);
	}
	return 0;
}

function field(value: unknown, name: string): unknown {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return undefined;
	}
	return Object.hasOwn(value, name)
		? (value as Record<string, unknown>)[name]
		: undefined;
}

async function handle(
	request: Request,
	context: Context,
): Promise<Json | undefined> {
	const id = field(request, 'id');
	// A notification carries no id, or a null one, and gets no reply.
	if (id === undefined || id === null) return undefined;

	const handled = await dispatch(
		request.method,
		field(request, 'params'),
		context,
	);
	if ('error' in handled) return { jsonrpc: '2.0', id, error: handled.error };
	return { jsonrpc: '2.0', id, result: handled.result };
}

async function dispatch(
	method: string,
	params: unknown,
	context: Context,
): Promise<Handled> {
	if (method === 'initialize') {
		return {
			result: {
				protocolVersion: PROTOCOL_VERSION,
				capabilities: { tools: {} },
				serverInfo: { name: 'scrape-le', version: context.version },
			},
		};
	}
	if (method === 'tools/list') return { result: { tools: TOOL_DEFINITIONS } };
	if (method === 'tools/call') return callTool(params, context);
	if (method === 'ping') return { result: {} };
	return {
		error: { code: METHOD_NOT_FOUND, message: `Unknown method: ${method}` },
	};
}

async function callTool(params: unknown, context: Context): Promise<Handled> {
	const name = field(params, 'name');
	if (typeof name !== 'string') {
		return {
			error: {
				code: INVALID_PARAMS,
				message: 'tools/call requires a string `name`',
			},
		};
	}
	const args = field(params, 'arguments') ?? {};
	if (name === 'analyze_robots_txt') {
		const analyzed = analyze(args);
		if (typeof analyzed === 'string') return { result: toolFailure(analyzed) };
		return { result: toolResult(analyzed) };
	}
	if (name === 'scrape_le_check')
		return { result: await checkTool(args, context) };
	if (name === 'scrape_le_doctor') return { result: doctorTool() };
	return {
		error: { code: INVALID_PARAMS, message: `Unknown tool: ${name}` },
	};
}

async function checkTool(args: unknown, context: Context): Promise<Json> {
	const urls = requestedUrls(args);
	if (typeof urls === 'string') return toolFailure(urls);
	const render = field(args, 'render');
	const agent = field(args, 'agent');
	const options = {
		noRender: !(typeof render === 'boolean' ? render : true),
		agent: typeof agent === 'string' ? agent : undefined,
		concurrency: DEFAULT_CONCURRENCY,
		ignoreCrawlDelay: false,
	};
	// The run is this call: the server outlives any answer it is safe to keep.
	const robots = createRobotsCache(context.version);
	const reports: Json[] = [];
	for (const [index, raw] of urls.entries()) {
		const url = targetUrl(raw);
		if (url === undefined)
			return toolFailure(`${raw} is not an http or https URL`);
		const position = urls.length > 1 ? index : undefined;
		const outcome = await checkUrl(url, position, options, robots, context);
		if (outcome.kind === 'malformed') return toolFailure(outcome.reason);
		reports.push(outcome.report);
	}
	const payload = reports.length === 1 ? reports[0] : { reports };
	const diagnostics = options.noRender
		? [
				warning(
					'render',
					'the page was not loaded in a browser, so the anti-bot and authentication checks ran partially and the verdict cannot be `clear`',
				),
			]
		: [];
	return toolResult(
		envelope('scrape_le_check', payload, reports.length, diagnostics),
	);
}

/**
 * An entry of the wrong shape is named, never dropped. `["…", 7]` used to
 * check one URL and report `count: 1` with nothing said about the other,
 * and `url: 7` was answered "no URL was supplied" — one was.
 */
function requestedUrls(args: unknown): string[] | string {
	const url = field(args, 'url');
	if (url !== undefined) {
		return typeof url === 'string' ? [url] : 'url must be a string';
	}
	const urls = field(args, 'urls');
	if (urls === undefined) return 'no URL was supplied to check';
	if (!Array.isArray(urls)) return 'urls must be a list of strings';
	const strings: string[] = [];
	for (const [index, item] of urls.entries()) {
		if (typeof item !== 'string')
			return `entry ${index} of urls is not a string`;
		strings.push(item);
	}
	if (strings.length === 0) return 'the list of URLs was empty';
	return strings;
}

function doctorTool(): Json {
	const browser = findBrowser();
	if (browser.ok) {
		return toolResult(
			envelope(
				'scrape_le_doctor',
				{
					browser: browser.path,
					render: 'available',
					checks_complete: true,
					detail: 'every check can run, so a `clear` verdict is reachable',
				},
				1,
				[],
			),
		);
	}
	return toolResult(
		envelope(
			'scrape_le_doctor',
			{
				browser: null,
				render: 'unavailable',
				checks_complete: false,
				detail: `${browser.reason}. robots.txt, status, headers and redirects still answer, but anti-bot and authentication run partially and the verdict can never be clear`,
			},
			1,
			[warning('render', browser.reason)],
		),
	);
}

/** `ok` reports whether the check ran, not whether the answer is yes. */
function envelope(
	tool: string,
	data: Json,
	count: number,
	diagnostics: readonly Json[],
): Json {
	const ok = !diagnostics.some((d) => field(d, 'severity') === 'error');
	return { ok, data, diagnostics, meta: { tool, count, truncated: false } };
}

function toolResult(envelopeValue: Json): Json {
	return {
		content: [
			{
				type: 'text',
				text: toJson(envelopeValue, { sorted: true, indent: 2 }),
			},
		],
		structuredContent: envelopeValue,
		isError: false,
	};
}

function toolFailure(message: string): Json {
	return { content: [{ type: 'text', text: message }], isError: true };
}

function warning(code: string, message: string): Json {
	return { severity: 'warning', code, message };
}

/**
 * `analyze_robots_txt`, the tool both servers offer. `crate/src/mcp/analyze.rs`
 * is held equal to the extension's by `scripts/check-differential.ts`; this
 * follows the crate, number formatting included.
 */
function analyze(args: unknown): Json | string {
	const content = field(args, 'content');
	if (typeof content !== 'string')
		return 'content is required and must be a string';
	const target = field(args, 'path');
	if (typeof target !== 'string')
		return 'path is required and must be a string';
	const maxResults = readMaxResults(args);
	if (typeof maxResults === 'string') return maxResults;
	const agentValue = field(args, 'agent');
	if (agentValue !== undefined && typeof agentValue !== 'string') {
		return 'agent must be a string';
	}

	const { pathname, note } = toPathname(target);
	const diagnostics =
		note === undefined
			? []
			: [{ severity: 'warning', code: 'robots', message: note }];
	const info = parseRobots(content).evaluate(pathname, agentValue);
	const disallowed = info.disallowedPaths.slice(0, maxResults);
	return {
		ok: true,
		data: {
			path: pathname,
			agent: info.agent,
			allowsCrawling: info.allowsCrawling,
			crawlDelay:
				info.crawlDelay === undefined ? undefined : jsNumber(info.crawlDelay),
			disallowedPaths: disallowed,
			sitemaps: info.sitemaps,
		},
		diagnostics,
		meta: {
			tool: 'analyze_robots_txt',
			count: disallowed.length,
			truncated: info.disallowedPaths.length > maxResults,
		},
	};
}

/**
 * The crate's `JsNumber`: a whole delay as an integer, saturating at `i64`'s
 * range the way `as i64` does, and anything else as a float.
 */
function jsNumber(seconds: number): Float | number | bigint {
	if (!Number.isFinite(seconds) || !Number.isInteger(seconds))
		return float(seconds);
	if (Number.isSafeInteger(seconds))
		return Object.is(seconds, -0) ? 0 : seconds;
	const max = 9223372036854775807n;
	const min = -9223372036854775808n;
	const big = BigInt(seconds);
	return big > max ? max : big < min ? min : big;
}

function readMaxResults(args: unknown): number | string {
	const raw = field(args, 'maxResults');
	if (raw === undefined || raw === null) return DEFAULT_MAX_RESULTS;
	const invalid = 'maxResults must be a positive integer';
	if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0)
		return invalid;
	if (raw >= 2 ** 64) return invalid;
	if (raw < 1) return invalid;
	return Math.min(raw, MAX_MAX_RESULTS);
}

/** Rules apply to a path, so a full URL is reduced to one. */
function toPathname(target: string): {
	pathname: string;
	note: string | undefined;
} {
	const trimmed = rustTrim(target);
	if (trimmed.startsWith('/')) return { pathname: trimmed, note: undefined };
	if (trimmed.includes('://')) {
		const candidate = normalizeUrl(trimmed);
		if (validateUrl(candidate)) {
			try {
				return { pathname: new URL(candidate).pathname, note: undefined };
			} catch {
				// Falls through to reading it as a path, as the crate does.
			}
		}
	}
	const pathname = `/${trimmed.replace(/^\/+/, '')}`;
	return {
		pathname,
		note: `\`${target}\` has no leading slash and no scheme; it was read as the path ${pathname}.`,
	};
}
