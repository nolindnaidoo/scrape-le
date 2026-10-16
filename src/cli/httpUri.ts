/**
 * A URL as the `http` crate reads it, which is what ureq requests.
 *
 * The crate hands the target URL to ureq as a string, so the request line is
 * whatever `http::Uri` makes of it: a fragment is dropped, an empty path
 * becomes `/`, a byte above ASCII is sent as it is, and a space is refused as
 * `invalid uri character`. The URL standard reads each of those differently,
 * so `new URL` cannot stand in for it. The tables below are the crate's
 * (http 1.x, `uri/path.rs` and `uri/mod.rs`).
 */

export type HttpUri = Readonly<{
	/** `undefined` for a URI with no scheme, which ureq then refuses */
	scheme: string | undefined;
	/** userinfo, host and port, as written */
	authority: string | undefined;
	/** `/` for an absolute URI with none, empty for a bare authority */
	path: string;
	query: string | undefined;
}>;

export type UriResult =
	| Readonly<{ ok: true; uri: HttpUri }>
	| Readonly<{ ok: false; message: string }>;

const MAX_LEN = 65534;

function pathClass(byte: number): 'valid' | 'query' | 'fragment' | 'invalid' {
	if (byte === 0x3f) return 'query';
	if (byte === 0x23) return 'fragment';
	if (byte >= 0x80) return 'valid';
	if (
		byte === 0x21 ||
		(byte >= 0x24 && byte <= 0x3b) ||
		byte === 0x3d ||
		(byte >= 0x40 && byte <= 0x5f) ||
		(byte >= 0x61 && byte <= 0x7a) ||
		byte === 0x7c ||
		byte === 0x7e ||
		byte === 0x22 ||
		byte === 0x7b ||
		byte === 0x7d
	) {
		return 'valid';
	}
	return 'invalid';
}

function queryClass(byte: number): 'valid' | 'fragment' | 'invalid' {
	if (byte === 0x23) return 'fragment';
	if (byte >= 0x80) return 'valid';
	if (
		byte === 0x21 ||
		(byte >= 0x24 && byte <= 0x3b) ||
		byte === 0x3d ||
		(byte >= 0x3f && byte <= 0x7e)
	) {
		return 'valid';
	}
	return 'invalid';
}

/** `URI_CHARS`: what an authority may hold besides `%`. */
const URI_CHARS = new Set(
	"!#$&'()*+,-./0123456789:;=?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[]_abcdefghijklmnopqrstuvwxyz~",
);

function fail(message: string): UriResult {
	return Object.freeze({ ok: false, message });
}

/** `SCHEME_CHARS`: what a scheme other than http and https may hold. */
const SCHEME_CHAR = /^[A-Za-z0-9+.-]$/;
const MAX_SCHEME_LEN = 64;

function ok(uri: HttpUri): UriResult {
	return Object.freeze({ ok: true, uri: Object.freeze(uri) });
}

/** `http::Uri::try_from`, with `http::uri::InvalidUri`'s messages. */
export function parseHttpUri(input: string): UriResult {
	const length = Buffer.byteLength(input, 'utf8');
	if (length === 0) return fail('empty string');
	if (length > MAX_LEN) return fail('uri too long');
	if (input === '/' || input === '*') {
		return ok({
			scheme: undefined,
			authority: undefined,
			path: input,
			query: undefined,
		});
	}
	if (input.startsWith('/')) {
		const scanned = scanPathAndQuery(input);
		if (typeof scanned === 'string') return fail(scanned);
		return ok({ scheme: undefined, authority: undefined, ...scanned });
	}
	const scheme = schemeOf(input);
	if (scheme === 'too long') return fail('scheme too long');
	const rest = scheme === undefined ? input : input.slice(scheme.length + 3);
	const end = authorityEnd(rest);
	if (typeof end === 'string') return fail(end);
	if (scheme === undefined) {
		if (end !== rest.length) return fail('invalid format');
		return ok({
			scheme: undefined,
			authority: rest,
			path: '',
			query: undefined,
		});
	}
	if (end === 0) return fail('invalid format');
	const authority = rest.slice(0, end);
	const tail = rest.slice(end);
	const lowered = /^https?$/i.test(scheme) ? scheme.toLowerCase() : scheme;
	if (tail === '') {
		return ok({ scheme: lowered, authority, path: '/', query: undefined });
	}
	const scanned = scanPathAndQuery(tail);
	if (typeof scanned === 'string') return fail(scanned);
	return ok({ scheme: lowered, authority, ...scanned });
}

/**
 * `Scheme2::parse`: http and https in any case, otherwise the run of scheme
 * characters before a `://`.
 */
function schemeOf(input: string): string | undefined | 'too long' {
	const lower = input.slice(0, 8).toLowerCase();
	if (lower.startsWith('http://')) return input.slice(0, 4);
	if (lower.startsWith('https://')) return input.slice(0, 5);
	if (input.length <= 3) return undefined;
	for (let i = 0; i < input.length; i += 1) {
		const char = input[i] as string;
		if (char === ':') {
			if (input.slice(i + 1, i + 3) !== '//') return undefined;
			if (i > MAX_SCHEME_LEN) return 'too long';
			return input.slice(0, i);
		}
		if (!SCHEME_CHAR.test(char)) return undefined;
	}
	return undefined;
}

/** Why ureq will not request a URI, in its `bad uri` words. */
export function refusedUri(uri: HttpUri): string | undefined {
	if (uri.scheme === undefined) return `${displayUri(uri)} is missing scheme`;
	if (uri.scheme !== 'http' && uri.scheme !== 'https') {
		return `unknown scheme: ${uri.scheme}`;
	}
	if (uri.authority === undefined) return `${displayUri(uri)} is missing host`;
	return undefined;
}

/** A path-and-query on its own, as a root-relative `Location` is read. */
export function parsePathAndQuery(
	input: string,
): { path: string; query: string | undefined } | string {
	if (input === '') return 'empty string';
	return scanPathAndQuery(input);
}

function scanPathAndQuery(
	input: string,
): { path: string; query: string | undefined } | string {
	const first = input[0];
	if (first !== '/' && first !== '?' && first !== '#') {
		return 'path does not start with slash';
	}
	const bytes = Buffer.from(input, 'utf8');
	let queryAt: number | undefined;
	let fragmentAt: number | undefined;
	let i = 0;
	for (; i < bytes.length; i += 1) {
		const kind = pathClass(bytes[i] as number);
		if (kind === 'query') {
			queryAt = i;
			i += 1;
			break;
		}
		if (kind === 'fragment') {
			fragmentAt = i;
			break;
		}
		if (kind === 'invalid') return 'invalid uri character';
	}
	if (queryAt !== undefined) {
		for (; i < bytes.length; i += 1) {
			const kind = queryClass(bytes[i] as number);
			if (kind === 'fragment') {
				fragmentAt = i;
				break;
			}
			if (kind === 'invalid') return 'invalid uri character';
		}
	}
	const data = bytes.subarray(0, fragmentAt ?? bytes.length);
	const decoded = decodeStrict(data);
	if (decoded === undefined) return 'invalid uri character';
	if (queryAt === undefined) {
		return { path: decoded === '' ? '/' : decoded, query: undefined };
	}
	const path = decodeStrict(data.subarray(0, queryAt)) ?? '';
	return {
		path: path === '' ? '/' : path,
		query: decodeStrict(data.subarray(queryAt + 1)) ?? '',
	};
}

function decodeStrict(bytes: Uint8Array): string | undefined {
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		return undefined;
	}
}

/** `validate_authority_bytes`: where the authority ends, or why it is bad. */
function authorityEnd(input: string): number | string {
	if (input === '') return 'empty string';
	let colons = 0;
	let openBracket = false;
	let closeBracket = false;
	let percent = false;
	let end = input.length;
	let at = input.length;
	for (let i = 0; i < input.length; i += 1) {
		const char = input[i] as string;
		if (char === '/' || char === '?' || char === '#') {
			end = i;
			break;
		}
		if (!URI_CHARS.has(char)) {
			if (char !== '%') return 'invalid uri character';
			percent = true;
			continue;
		}
		if (char === ':') {
			if (colons >= 8) return 'invalid authority';
			colons += 1;
			continue;
		}
		if (char === '[') {
			if (percent || openBracket) return 'invalid authority';
			openBracket = true;
			continue;
		}
		if (char === ']') {
			if (!openBracket || closeBracket) return 'invalid authority';
			closeBracket = true;
			colons = 0;
			percent = false;
			continue;
		}
		if (char === '@') {
			at = i;
			colons = 0;
			percent = false;
		}
	}
	if (openBracket !== closeBracket) return 'invalid authority';
	if (colons > 1) return 'invalid authority';
	if (end > 0 && at === end - 1) return 'invalid authority';
	if (percent) return 'invalid authority';
	return end;
}

/** `Uri`'s `Display`: no fragment, and `/` for an absolute URI's empty path. */
export function displayUri(uri: HttpUri): string {
	const scheme = uri.scheme === undefined ? '' : `${uri.scheme}://`;
	const query = uri.query === undefined ? '' : `?${uri.query}`;
	return `${scheme}${uri.authority ?? ''}${uri.path}${query}`;
}

/** Host and port to connect to, and the `host` header ureq sends. */
export function endpointOf(uri: HttpUri): {
	host: string;
	port: number;
	hostHeader: string;
	userinfo: string | undefined;
} {
	const authority = uri.authority ?? '';
	const at = authority.lastIndexOf('@');
	const userinfo = at === -1 ? undefined : authority.slice(0, at);
	const hostPort = authority.slice(at + 1);
	const bracket = hostPort.lastIndexOf(']');
	const colon = hostPort.lastIndexOf(':');
	const hasPort = colon > bracket;
	const rawHost = hasPort ? hostPort.slice(0, colon) : hostPort;
	const host = rawHost.replace(/^\[(.*)\]$/, '$1');
	const defaultPort = uri.scheme === 'https' ? 443 : 80;
	const port = hasPort ? Number(hostPort.slice(colon + 1)) : defaultPort;
	return { host, port, hostHeader: hostPort, userinfo };
}

/**
 * `Location` against the URL that answered: ureq-proto's `join`. An absolute
 * URL replaces it, `//host` keeps its scheme, `/path` keeps its authority, and
 * anything else is joined to its path segment by segment.
 */
export function joinLocation(
	base: HttpUri,
	location: string,
): HttpUri | string {
	const bad = `location header is malformed: ${location}`;
	const absolute = parseHttpUri(location);
	if (absolute.ok && absolute.uri.scheme !== undefined) return absolute.uri;
	if (location.startsWith('//')) {
		const joined = parseHttpUri(`${base.scheme}:${location}`);
		return joined.ok ? joined.uri : bad;
	}
	const target = location.startsWith('/')
		? location
		: joinRelative(base.path, location);
	if (target === undefined) return bad;
	const parsed = parsePathAndQuery(target);
	if (typeof parsed === 'string') return bad;
	return Object.freeze({ ...base, ...parsed });
}

function joinRelative(basePath: string, location: string): string | undefined {
	const joiner = basePath.split('/');
	if (joiner.length > 1) joiner.pop();
	for (const segment of location.split('/')) {
		if (segment === '.') continue;
		if (segment === '..') {
			if (joiner.length === 1) return undefined;
			joiner.pop();
			continue;
		}
		joiner.push(segment);
	}
	return joiner.join('/');
}
