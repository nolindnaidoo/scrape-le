/**
 * HTTP evidence and the run's robots.txt cache: `crate/src/fetch.rs`. Scope is
 * the URL under check plus that origin's `/robots.txt`, nothing else.
 */
import { type HttpFailure, httpGet } from './http';
import type { Evidence } from './report';
import { parseRobots, type RobotsDocument, unreachableRobots } from './robots';

/** A DNS failure or timeout is a malformed question; anything else is `blocked`. */
export type FetchError = Readonly<{
	kind: 'malformed' | 'blocked';
	reason: string;
}>;

/**
 * One parsed robots.txt per origin for a run. Only a document an origin served
 * is kept: a 404, a 5xx or a dropped connection is asked again by the next URL,
 * so a blip never reads as permission for the rest of the batch.
 */
export type RobotsCache = Readonly<{
	document: (url: string) => Promise<RobotsDocument | undefined>;
}>;

export function createRobotsCache(version: string): RobotsCache {
	const origins = new Map<string, RobotsDocument>();
	return Object.freeze({
		document: async (url: string): Promise<RobotsDocument | undefined> => {
			const origin = originOf(url);
			if (origin === undefined) return undefined;
			const held = origins.get(origin);
			if (held) return held;
			const fetched = await fetchRobots(origin, version);
			if (fetched.kind === 'absent') return undefined;
			if (fetched.kind === 'unreachable') return unreachableRobots();
			const document = parseRobots(fetched.body);
			origins.set(origin, document);
			return document;
		},
	});
}

function originOf(url: string): string | undefined {
	try {
		const origin = new URL(url).origin;
		return origin === 'null' ? undefined : origin;
	} catch {
		return undefined;
	}
}

type RobotsFetch =
	| { kind: 'served'; body: string }
	| { kind: 'absent' }
	| { kind: 'unreachable' };

/** RFC 9309: a 4xx means no rules, a 5xx or a failure means rules unread. */
async function fetchRobots(
	origin: string,
	version: string,
): Promise<RobotsFetch> {
	const result = await httpGet(`${origin}/robots.txt`, version);
	if (!result.ok) return { kind: 'unreachable' };
	const { status, body } = result.response;
	if (status >= 500 && status < 600) return { kind: 'unreachable' };
	if (status < 200 || status >= 300) return { kind: 'absent' };
	if (body === undefined) return { kind: 'unreachable' };
	return { kind: 'served', body };
}

export async function fetchEvidence(
	url: string,
	robots: RobotsCache,
	version: string,
): Promise<
	{ ok: true; evidence: Evidence } | { ok: false; error: FetchError }
> {
	const started = Date.now();
	const result = await httpGet(url, version);
	if (!result.ok) return { ok: false, error: classify(result.failure) };
	const fetchMs = Date.now() - started;
	const { status, finalUrl, headers, body } = result.response;
	const document = await robots.document(url);
	return {
		ok: true,
		evidence: {
			url,
			finalUrl,
			status,
			headers,
			bodyHtml: body ?? '',
			robots: document,
			render: undefined,
			fetchMs,
			totalMs: Date.now() - started,
		},
	};
}

function classify(failure: HttpFailure): FetchError {
	if (failure.kind === 'timeout') {
		return { kind: 'malformed', reason: `timed out: ${failure.message}` };
	}
	if (failure.kind === 'baduri') {
		return {
			kind: 'malformed',
			reason: `unparseable URL: bad uri: ${failure.message}`,
		};
	}
	if (failure.kind === 'io') {
		// The resolver's own words are the only signal that a name did not
		// resolve: "lookup address" from getaddrinfo, "No such host" on Windows.
		if (
			failure.message.includes('lookup address') ||
			failure.message.includes('No such host')
		) {
			return { kind: 'malformed', reason: `DNS failure: ${failure.message}` };
		}
		return {
			kind: 'blocked',
			reason: `could not fetch the page: io: ${failure.message}`,
		};
	}
	return {
		kind: 'blocked',
		reason: `could not fetch the page: ${failure.message}`,
	};
}
