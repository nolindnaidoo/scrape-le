/**
 * One GET the way the crate's ureq agent makes it: HTTP/1.1, the same four
 * request headers in the same order, `gzip` accepted, at most ten redirects,
 * and twenty seconds for the whole call. `crate/src/fetch.rs` configures it.
 *
 * Written on a socket rather than `node:http` because Node refuses to send a
 * path holding a byte above ASCII, and ureq sends it as it is. A site answers
 * the request it was sent, so the two binaries have to send the same one.
 */
import { connect as connectTcp, type Socket } from 'node:net';
import { connect as connectTls } from 'node:tls';
import { gunzipSync } from 'node:zlib';
import {
	displayUri,
	endpointOf,
	type HttpUri,
	joinLocation,
	parseHttpUri,
	refusedUri,
} from './httpUri';
import { rustNetMessage } from './netError';

export const BODY_LIMIT = 2 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 10;

export type HttpResponse = Readonly<{
	status: number;
	finalUrl: string;
	/** lowercased names; a repeated header keeps its last value */
	headers: ReadonlyMap<string, string>;
	/** `undefined` when the body could not be read as UTF-8 within the limit */
	body: string | undefined;
}>;

/** How a call failed, in ureq's words. */
export type HttpFailure = Readonly<{
	/** `io` carries the bare `io::Error` text, which `fetch.ts` classifies */
	kind: 'timeout' | 'io' | 'baduri' | 'other';
	message: string;
}>;

export type HttpResult =
	| Readonly<{ ok: true; response: HttpResponse }>
	| Readonly<{ ok: false; failure: HttpFailure }>;

type Raw = {
	status: number;
	headers: [string, string][];
	body: Buffer | undefined;
};

export async function httpGet(
	url: string,
	version: string,
): Promise<HttpResult> {
	const parsed = parseHttpUri(url);
	if (!parsed.ok) {
		return failure('other', `http: ${parsed.message}`);
	}
	const deadline = Date.now() + TIMEOUT_MS;
	let uri = parsed.uri;
	let redirects = 0;
	while (true) {
		const refused = refusedUri(uri);
		if (refused !== undefined) return failure('baduri', refused);
		let raw: Raw;
		try {
			raw = await exchange(uri, version, deadline);
		} catch (error) {
			return failureOf(error);
		}
		if (raw.status >= 300 && raw.status < 400 && raw.status !== 304) {
			const location = lastHeader(raw.headers, 'location');
			if (location === undefined) {
				return failure('other', 'protocol: missing a location header');
			}
			if (redirects >= MAX_REDIRECTS) {
				return failure('other', 'too many redirects');
			}
			const next = joinLocation(uri, location);
			if (typeof next === 'string')
				return failure('other', `protocol: ${next}`);
			uri = next;
			redirects += 1;
			continue;
		}
		return Object.freeze({
			ok: true,
			response: Object.freeze({
				status: raw.status,
				finalUrl: displayUri(uri),
				headers: headerMap(raw.headers),
				body: bodyText(raw),
			}),
		});
	}
}

function failure(kind: HttpFailure['kind'], message: string): HttpResult {
	return Object.freeze({
		ok: false,
		failure: Object.freeze({ kind, message }),
	});
}

function failureOf(error: unknown): HttpResult {
	if (tagOf(error) === 'timeout') return failure('timeout', 'timeout: global');
	// ureq's own words for a connection that closed before an answer.
	if (tagOf(error) === 'eof') return failure('io', 'Peer disconnected');
	// rustls meeting a plain-HTTP answer where a TLS record should be.
	const code = (error as { code?: unknown } | null)?.code;
	if (
		code === 'ERR_SSL_WRONG_VERSION_NUMBER' ||
		code === 'ERR_SSL_PACKET_LENGTH_TOO_LONG'
	) {
		return failure('io', 'received corrupt message of type InvalidContentType');
	}
	if (tagOf(error) === 'protocol')
		return failure('other', `protocol: ${(error as Error).message}`);
	return failure('io', rustNetMessage(error));
}

type Tag = 'timeout' | 'protocol' | 'eof';
type Tagged = Error & { readonly tag?: Tag };

function tagged(tag: Tag, message: string): Tagged {
	return Object.assign(new Error(message), { tag });
}

function tagOf(error: unknown): string | undefined {
	return (error as Tagged | null)?.tag;
}

function lastHeader(
	headers: readonly [string, string][],
	name: string,
): string | undefined {
	let found: string | undefined;
	for (const [key, value] of headers) {
		if (key === name) found = value;
	}
	return found;
}

/**
 * `HeaderValue::to_str` refuses anything but visible ASCII and tab, and the
 * crate drops a header it cannot read as a string.
 */
function headerMap(headers: readonly [string, string][]): Map<string, string> {
	const map = new Map<string, string>();
	for (const [name, value] of headers) {
		if (!/^[\t\x20-\x7e]*$/.test(value)) continue;
		map.set(name, value);
	}
	return map;
}

/** Over the limit, compressed wrong or not UTF-8: no body, as `unwrap_or_default` has it. */
function bodyText(raw: Raw): string | undefined {
	if (raw.body === undefined) return undefined;
	let bytes = raw.body;
	if (lastHeader(raw.headers, 'content-encoding')?.toLowerCase() === 'gzip') {
		try {
			bytes = gunzipSync(bytes, { maxOutputLength: BODY_LIMIT + 1 });
		} catch {
			return undefined;
		}
	}
	// ureq's limit reader refuses the read after the last allowed byte, so a
	// body of exactly the limit is refused too.
	if (bytes.length >= BODY_LIMIT) return undefined;
	try {
		return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
			bytes,
		);
	} catch {
		return undefined;
	}
}

function exchange(
	uri: HttpUri,
	version: string,
	deadline: number,
): Promise<Raw> {
	const { host, port, hostHeader, userinfo } = endpointOf(uri);
	const query = uri.query === undefined ? '' : `?${uri.query}`;
	const lines = [
		`GET ${uri.path}${query} HTTP/1.1`,
		'accept-encoding: gzip',
		`user-agent: scrape-le/${version}`,
		'accept: */*',
		`host: ${hostHeader}`,
	];
	if (userinfo !== undefined) {
		lines.push(`authorization: Basic ${basicCredentials(userinfo)}`);
	}
	const request = Buffer.from(`${lines.join('\r\n')}\r\n\r\n`, 'utf8');

	return new Promise((resolve, reject) => {
		const socket: Socket =
			uri.scheme === 'https'
				? connectTls({
						host,
						port,
						servername: /^[0-9.]+$|:/.test(host) ? '' : host,
						ALPNProtocols: ['http/1.1'],
					})
				: connectTcp({ host, port });
		const chunks: Buffer[] = [];
		let settled = false;
		const timer = setTimeout(
			() => finish(tagged('timeout', 'timeout')),
			Math.max(0, deadline - Date.now()),
		);

		function finish(error: Error | undefined, raw?: Raw): void {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			socket.destroy();
			if (error) {
				// A response whose head arrived keeps its status when the body
				// stalls: the body, not the call, is what ran out of time.
				const partial =
					tagOf(error) === 'timeout' ? parseHead(chunks) : undefined;
				if (partial) {
					resolve({ ...partial, body: undefined });
					return;
				}
				reject(error);
				return;
			}
			resolve(raw as Raw);
		}

		socket.once(uri.scheme === 'https' ? 'secureConnect' : 'connect', () => {
			socket.write(request);
		});
		socket.on('data', (chunk: Buffer) => {
			chunks.push(chunk);
			const complete = parseComplete(chunks, false);
			if (complete instanceof Error) {
				finish(complete);
				return;
			}
			if (complete) finish(undefined, complete);
		});
		socket.on('end', () => {
			const complete = parseComplete(chunks, true);
			if (complete instanceof Error) {
				finish(complete);
				return;
			}
			if (complete) {
				finish(undefined, complete);
				return;
			}
			finish(tagged('eof', 'Peer disconnected'));
		});
		socket.on('error', (error) => finish(error));
	});
}

function basicCredentials(userinfo: string): string {
	const colon = userinfo.indexOf(':');
	const user = colon === -1 ? userinfo : userinfo.slice(0, colon);
	const password = colon === -1 ? '' : userinfo.slice(colon + 1);
	const decode = (part: string): string => {
		try {
			return decodeURIComponent(part);
		} catch {
			return part;
		}
	};
	return Buffer.from(`${decode(user)}:${decode(password)}`, 'utf8').toString(
		'base64',
	);
}

type Head = { status: number; headers: [string, string][]; bodyStart: number };

function headOf(buffer: Buffer): Head | undefined | Error {
	const end = buffer.indexOf('\r\n\r\n');
	if (end === -1) return undefined;
	const lines = buffer.subarray(0, end).toString('latin1').split('\r\n');
	const statusLine = /^HTTP\/1\.[01] (\d{3})(?: .*)?$/.exec(lines[0] ?? '');
	if (!statusLine)
		return tagged('protocol', 'http parse fail: invalid HTTP version');
	const headers: [string, string][] = [];
	for (const line of lines.slice(1)) {
		const colon = line.indexOf(':');
		if (colon <= 0)
			return tagged('protocol', 'http parse fail: invalid header name');
		headers.push([
			line.slice(0, colon).trim().toLowerCase(),
			line.slice(colon + 1).trim(),
		]);
	}
	return { status: Number(statusLine[1]), headers, bodyStart: end + 4 };
}

function parseHead(chunks: readonly Buffer[]): Omit<Raw, 'body'> | undefined {
	const head = headOf(Buffer.concat(chunks));
	if (!head || head instanceof Error) return undefined;
	return { status: head.status, headers: head.headers };
}

/** The whole response once it has arrived, by length, chunks or close. */
function parseComplete(
	chunks: readonly Buffer[],
	closed: boolean,
): Raw | undefined | Error {
	const buffer = Buffer.concat(chunks);
	const head = headOf(buffer);
	if (head === undefined || head instanceof Error) return head;
	// An interim 1xx carries no body; the real response follows it.
	if (head.status >= 100 && head.status < 200) {
		return parseComplete([buffer.subarray(head.bodyStart)], closed);
	}
	const body = buffer.subarray(head.bodyStart);
	const raw = (bytes: Buffer | undefined): Raw => ({
		status: head.status,
		headers: head.headers,
		body: bytes,
	});
	if (head.status === 204 || head.status === 304) return raw(Buffer.alloc(0));
	const transfer = lastHeader(head.headers, 'transfer-encoding');
	if (transfer?.toLowerCase().includes('chunked')) {
		const decoded = dechunk(body);
		if (decoded instanceof Error) return decoded;
		if (decoded) return raw(decoded);
		return closed ? raw(undefined) : undefined;
	}
	const length = lastHeader(head.headers, 'content-length');
	if (length !== undefined) {
		const size = Number(length);
		if (!Number.isSafeInteger(size)) {
			return tagged('protocol', 'content-length header not a number');
		}
		if (body.length >= size) return raw(body.subarray(0, size));
		return closed ? raw(undefined) : undefined;
	}
	return closed ? raw(body) : undefined;
}

function dechunk(body: Buffer): Buffer | undefined | Error {
	const parts: Buffer[] = [];
	let offset = 0;
	while (true) {
		const lineEnd = body.indexOf('\r\n', offset);
		if (lineEnd === -1) return undefined;
		const sizeText =
			body.subarray(offset, lineEnd).toString('latin1').split(';')[0]?.trim() ??
			'';
		if (!/^[0-9A-Fa-f]+$/.test(sizeText)) {
			return tagged('protocol', 'chunk length cannot be read as a number');
		}
		const size = Number.parseInt(sizeText, 16);
		const start = lineEnd + 2;
		if (size === 0) return Buffer.concat(parts);
		if (body.length < start + size + 2) return undefined;
		parts.push(body.subarray(start, start + size));
		offset = start + size + 2;
	}
}
