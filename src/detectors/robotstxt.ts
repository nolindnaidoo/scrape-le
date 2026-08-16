/**
 * robots.txt fetching and parsing.
 *
 * Follows RFC 9309 group and matching semantics for the rules that
 * apply to all crawlers (User-agent: *):
 * - consecutive User-agent lines form one group header; any other
 *   directive closes the header, and the group's rules apply when any
 *   of its agents is '*'
 * - Allow and Disallow both participate; the longest matching pattern
 *   wins, Allow winning ties
 * - patterns support '*' (any characters) and a trailing '$' anchor
 * - §2.2.2: octets outside ASCII are percent-encoded on both sides
 *   before comparison, and "longest" counts the encoded form's octets
 *
 * Honest limitations: agent-specific groups are ignored entirely (we
 * only report the generic rules — a site may treat your specific
 * scraper differently), and crawl-delay is a de-facto extension, not
 * part of the RFC.
 */

import type { RobotsTxtInfo } from '../types';

/**
 * Fetches and parses robots.txt for a given URL
 */
export async function fetchRobotsTxt(url: string): Promise<RobotsTxtInfo> {
	try {
		// Extract origin from URL
		const urlObj = new URL(url);
		const robotsUrl = `${urlObj.origin}/robots.txt`;

		// Fetch with timeout
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 5000);

		const response = await fetch(robotsUrl, {
			signal: controller.signal,
			headers: {
				'User-Agent': 'Scrape-LE/2.0 (VS Code Extension)',
			},
		});

		clearTimeout(timeoutId);

		// Early return if robots.txt doesn't exist or is inaccessible
		if (!response.ok) {
			return createDefaultRobotsTxtInfo(false);
		}

		const content = await response.text();
		return parseRobotsTxt(content, urlObj.pathname);
	} catch (error) {
		// Rethrown rather than swallowed into a default result. Returning the
		// all-clear on error made a crashed check indistinguishable from a clean
		// one — the report stated "Not detected" for a detection that never ran.
		// runDetections records the failure and the report shows it.
		// A failed fetch previously rendered as "no robots.txt", which a reader
		// could take as "scraping is unrestricted".
		throw error;
	}
}

type RobotsRule = Readonly<{
	allow: boolean;
	/** As the file spells it — what a finding quotes back to the reader. */
	pattern: string;
	/** What the comparison and the length actually use. */
	encoded: string;
}>;

const UTF8 = new TextEncoder();
const HEX_DIGITS = '0123456789ABCDEF';

function isHexDigit(byte: number | undefined): boolean {
	if (byte === undefined) {
		return false;
	}
	// 0-9, A-F, a-f
	return (
		(byte >= 0x30 && byte <= 0x39) ||
		(byte >= 0x41 && byte <= 0x46) ||
		(byte >= 0x61 && byte <= 0x66)
	);
}

/**
 * RFC 9309 §2.2.2's canonical form for comparison: every octet outside
 * ASCII percent-encoded, and a well-formed `%XX` already present left where
 * it is with its hex digits upper-cased.
 *
 * **The scope is Google's reference parser's `MaybeEscapePattern`, exactly**
 * — high-bit octets and hex casing, nothing else. Reserved ASCII is
 * deliberately untouched: a pattern's `*` and `$` are the RFC's own special
 * characters (§2.2.3) and `/` is the path separator, so encoding them would
 * turn every wildcard into a literal. A robots.txt that means a literal
 * asterisk writes `%2A` itself.
 *
 * Recognising an existing escape is what makes this idempotent, and that is
 * load-bearing rather than tidy: the two entry points disagree about what
 * they hand over. `URL.pathname` gives an already-encoded path, while an MCP
 * caller gives whatever it typed. Encoding blindly would turn `/caf%C3%A9`
 * into `/caf%25C3%25A9` and match nothing.
 *
 * **Not implemented, on purpose:** §2.2.2's second paragraph also has a
 * percent-encoded *unreserved* octet decoded before comparison, so
 * `/foo/%62%61%7A` matches `/foo/baz`. Google's parser does not do it and
 * neither do we — following the reference implementation keeps the two
 * frontends answering what the crawler ecosystem answers, and guessing wider
 * than the reference here would move paths toward "allowed" on nobody else's
 * authority.
 */
export function canonicalizeRobotsPath(value: string): string {
	const bytes = UTF8.encode(value);
	let out = '';

	for (let index = 0; index < bytes.length; index++) {
		const byte = bytes[index] as number;
		const high = bytes[index + 1];
		const low = bytes[index + 2];

		if (byte === 0x25 && isHexDigit(high) && isHexDigit(low)) {
			out += `%${String.fromCharCode(high as number, low as number).toUpperCase()}`;
			index += 2;
			continue;
		}
		if (byte < 0x80) {
			out += String.fromCharCode(byte);
			continue;
		}
		out += `%${HEX_DIGITS[byte >> 4]}${HEX_DIGITS[byte & 0x0f]}`;
	}

	return out;
}

/**
 * Parses robots.txt content against the generic (User-agent: *) rules.
 *
 * Exported for the MCP server, which analyses robots.txt content the caller
 * already has rather than fetching it. Reaching the network from inside an
 * agent loop would make this an SSRF primitive — `fetchRobotsTxt` builds its
 * URL from an arbitrary origin, so `http://169.254.169.254/robots.txt`
 * resolves — and the analysis is the useful half anyway.
 */
export function parseRobotsTxt(
	content: string,
	pathname: string,
): RobotsTxtInfo {
	try {
		const rules: RobotsRule[] = [];
		const sitemaps: string[] = [];
		let crawlDelay: number | undefined;

		let groupAgents: string[] = [];
		let inGroupHeader = false;

		for (const rawLine of content.split('\n')) {
			// comments run from '#' to end of line
			const hashIndex = rawLine.indexOf('#');
			const line = (
				hashIndex === -1 ? rawLine : rawLine.slice(0, hashIndex)
			).trim();
			if (!line) {
				continue;
			}

			const colonIndex = line.indexOf(':');
			if (colonIndex === -1) {
				continue;
			}

			const directive = line.substring(0, colonIndex).trim().toLowerCase();
			const value = line.substring(colonIndex + 1).trim();

			if (directive === 'user-agent') {
				if (!inGroupHeader) {
					groupAgents = [];
					inGroupHeader = true;
				}
				groupAgents.push(value.toLowerCase());
				continue;
			}

			// any non-user-agent directive closes the group header
			inGroupHeader = false;
			const groupAppliesToAll = groupAgents.includes('*');

			if (directive === 'sitemap') {
				// sitemap is not group-scoped
				if (value) {
					sitemaps.push(value);
				}
				continue;
			}

			if (!groupAppliesToAll) {
				continue;
			}

			if ((directive === 'disallow' || directive === 'allow') && value) {
				// Matched and measured encoded; reported raw, so the finding
				// quotes the line the file actually carries rather than a
				// canonical form the reader would not find in it.
				rules.push(
					Object.freeze({
						allow: directive === 'allow',
						pattern: value,
						encoded: canonicalizeRobotsPath(value),
					}),
				);
				continue;
			}

			if (directive === 'crawl-delay') {
				const delay = Number.parseFloat(value);
				if (!Number.isNaN(delay) && delay >= 0) {
					crawlDelay = delay;
				}
			}
		}

		return Object.freeze({
			exists: true,
			// RFC 9309 §2.2.2: the comparison happens on the encoded form, on
			// both sides of it. The path arrives encoded from `URL.pathname`
			// and raw from an MCP caller that typed it, and
			// `canonicalizeRobotsPath` is idempotent so either spelling lands
			// here as one string.
			allowsCrawling: isPathAllowed(canonicalizeRobotsPath(pathname), rules),
			crawlDelay,
			disallowedPaths: Object.freeze(
				rules.filter((r) => !r.allow).map((r) => r.pattern),
			),
			sitemaps: Object.freeze(sitemaps),
		});
	} catch (error) {
		console.error('Error parsing robots.txt:', error);
		// If parsing fails, assume it exists but allow crawling (safe default)
		return createDefaultRobotsTxtInfo(true);
	}
}

/**
 * RFC 9309 matching: longest matching pattern wins, Allow wins ties;
 * no matching rule means allowed.
 *
 * `path` and every rule's `encoded` are already in the canonical form —
 * §2.2.2 compares there, and "longest" counts that form's octets. Because
 * the canonical form is pure ASCII, `.length` counts octets here and
 * `str::len` counts them in the crate: the two frontends measure one number
 * rather than UTF-16 code units against bytes.
 */
function isPathAllowed(path: string, rules: readonly RobotsRule[]): boolean {
	let bestLength = -1;
	let bestAllow = true;

	for (const rule of rules) {
		if (!matchesRobotsPattern(rule.encoded, path)) {
			continue;
		}
		if (
			rule.encoded.length > bestLength ||
			(rule.encoded.length === bestLength && rule.allow && !bestAllow)
		) {
			bestLength = rule.encoded.length;
			bestAllow = rule.allow;
		}
	}

	return bestAllow;
}

/**
 * Matches a robots.txt pattern against a path, both already canonicalized:
 * anchored at the start, '*' matches any character sequence, a trailing '$'
 * anchors the end.
 */
export function matchesRobotsPattern(
	pattern: string,
	pathname: string,
): boolean {
	const anchored = pattern.endsWith('$');
	const body = anchored ? pattern.slice(0, -1) : pattern;

	const escaped = body
		.split('*')
		.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
		.join('[\\s\\S]*');

	const regex = new RegExp(`^${escaped}${anchored ? '$' : ''}`);
	return regex.test(pathname);
}

/**
 * Creates default robots.txt info
 */
function createDefaultRobotsTxtInfo(exists: boolean): RobotsTxtInfo {
	return Object.freeze({
		exists,
		allowsCrawling: true, // Default to allowing if uncertain
		disallowedPaths: Object.freeze([]),
		sitemaps: Object.freeze([]),
	});
}

export const RobotsTxtChecker = Object.freeze({
	fetchRobotsTxt,
});
