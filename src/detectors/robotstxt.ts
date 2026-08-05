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

type RobotsRule = Readonly<{ allow: boolean; pattern: string }>;

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
				rules.push(
					Object.freeze({ allow: directive === 'allow', pattern: value }),
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
			allowsCrawling: isPathAllowed(pathname, rules),
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
 */
function isPathAllowed(
	pathname: string,
	rules: readonly RobotsRule[],
): boolean {
	let bestLength = -1;
	let bestAllow = true;

	for (const rule of rules) {
		if (!matchesRobotsPattern(rule.pattern, pathname)) {
			continue;
		}
		if (
			rule.pattern.length > bestLength ||
			(rule.pattern.length === bestLength && rule.allow && !bestAllow)
		) {
			bestLength = rule.pattern.length;
			bestAllow = rule.allow;
		}
	}

	return bestAllow;
}

/**
 * Matches a robots.txt pattern against a path: anchored at the start,
 * '*' matches any character sequence, a trailing '$' anchors the end.
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
