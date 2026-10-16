/**
 * The URL a run checks, decided the way `crate/src/detect/url.rs` decides it.
 *
 * The extension's `utils/url.ts` is the reference both ports follow, and this
 * file keeps its quirks, including the blind `https://` prefixing. What it adds
 * is the crate's guard in front of them (`target_url`, `target_in_text`) and
 * two places where JavaScript and Rust read the same characters differently:
 * which characters `trim` removes, and what `\b` counts as a word.
 */

/**
 * `str::trim`: Unicode White_Space. JavaScript's `trim` also removes U+FEFF,
 * which Rust keeps, and keeps U+0085, which Rust removes.
 */
const RUST_SPACE =
	'[\\t\\n\\v\\f\\r \\u0085\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000]';
const LEADING = new RegExp(`^${RUST_SPACE}+`, 'u');
const TRAILING = new RegExp(`${RUST_SPACE}+$`, 'u');

export function rustTrim(value: string): string {
	return value.replace(LEADING, '').replace(TRAILING, '');
}

export function rustTrimStart(value: string): string {
	return value.replace(LEADING, '');
}

/**
 * The `regex` crate's `\b` is Unicode-aware, so `é` is a word character there
 * and not in a JavaScript pattern. Spelled out with lookarounds over Rust's
 * definition of `\w`.
 */
const WORD = '[\\p{Alphabetic}\\p{M}\\p{Nd}\\p{Pc}\\p{Join_Control}]';
const BOUNDARY = `(?:(?<=${WORD})(?!${WORD})|(?<!${WORD})(?=${WORD}))`;
const BODY = `https?://(www\\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\\.[a-zA-Z0-9()]{1,6}${BOUNDARY}([-a-zA-Z0-9()@:%_+.~#?&/=]*)`;
const VALIDATE = new RegExp(`^${BODY}$`, 'u');
const EXTRACT = new RegExp(BODY, 'u');

function parses(url: string): URL | undefined {
	try {
		return new URL(url);
	} catch {
		return undefined;
	}
}

/** Native parsing first, the extension's regex when it refuses. */
export function validateUrl(url: string): boolean {
	const trimmed = rustTrim(url);
	if (trimmed === '') return false;
	const parsed = parses(trimmed);
	if (parsed)
		return parsed.protocol === 'http:' || parsed.protocol === 'https:';
	return VALIDATE.test(trimmed);
}

export function normalizeUrl(url: string): string {
	const trimmed = rustTrim(url);
	if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
		return trimmed;
	}
	return `https://${trimmed}`;
}

/** The URL a command-line argument names, or none this tool can answer for. */
export function targetUrl(raw: string): string | undefined {
	const trimmed = rustTrim(raw);
	const scheme = schemeOf(trimmed);
	if (scheme !== undefined && !isHttp(scheme)) return undefined;
	const candidate =
		scheme === undefined
			? normalizeUrl(trimmed)
			: `${scheme.toLowerCase()}${trimmed.slice(scheme.length)}`;
	return validateUrl(candidate) ? candidate : undefined;
}

/** The same for a batch entry, which may carry its URL amid other text. */
export function targetInText(raw: string): string | undefined {
	const scheme = schemeOf(rustTrim(raw));
	if (scheme !== undefined && !isHttp(scheme)) return undefined;
	if (scheme !== undefined) return targetUrl(raw) ?? extractUrl(raw);
	return extractUrl(raw);
}

/** A scheme with or without `://`; a colon followed by a port is a host. */
function schemeOf(url: string): string | undefined {
	const authority = url.indexOf('://');
	if (authority !== -1) return validScheme(url.slice(0, authority));
	const colon = url.indexOf(':');
	if (colon === -1) return undefined;
	const scheme = validScheme(url.slice(0, colon));
	if (scheme === undefined) return undefined;
	return isPort(url.slice(colon + 1)) ? undefined : scheme;
}

function validScheme(scheme: string): string | undefined {
	return /^[A-Za-z][A-Za-z0-9+.-]*$/.test(scheme) ? scheme : undefined;
}

function isPort(rest: string): boolean {
	const port = rest.split(/[/?#]/)[0] ?? rest;
	return /^[0-9]*$/.test(port);
}

/** Only ever given a scheme `validScheme` passed, which is ASCII. */
function isHttp(scheme: string): boolean {
	const lower = scheme.toLowerCase();
	return lower === 'http' || lower === 'https';
}

export function extractUrl(text: string): string | undefined {
	if (text === '') return undefined;
	const found = EXTRACT.exec(text);
	if (found) return found[0];
	const normalized = normalizeUrl(text);
	return validateUrl(normalized) ? normalized : undefined;
}
