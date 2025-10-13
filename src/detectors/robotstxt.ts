/**
 * robots.txt fetching and parsing
 */

import type { RobotsTxtInfo } from '../types';

/**
 * Fetches and parses robots.txt for a given URL
 * @param url - The URL to check
 * @returns robots.txt information
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
				'User-Agent': 'Scrape-LE/1.0 (VS Code Extension)',
			},
		});

		clearTimeout(timeoutId);

		if (!response.ok) {
			// robots.txt doesn't exist or is inaccessible
			return createDefaultRobotsTxtInfo(false);
		}

		const content = await response.text();
		return parseRobotsTxt(content, urlObj.pathname);
	} catch (error) {
		// Fetch failed (network error, timeout, etc.)
		console.error('Error fetching robots.txt:', error);
		return createDefaultRobotsTxtInfo(false);
	}
}

/**
 * Parses robots.txt content
 * @param content - Raw robots.txt content
 * @param pathname - The path being checked
 * @returns Parsed robots.txt information
 */
function parseRobotsTxt(content: string, pathname: string): RobotsTxtInfo {
	try {
		const lines = content.split('\n');
		const disallowedPaths: string[] = [];
		let crawlDelay: number | undefined;
		let sitemap: string | undefined;
		let inUserAgentBlock = false;
		let appliesToAll = false;

		for (const line of lines) {
			const trimmed = line.trim();

			// Skip comments and empty lines
			if (!trimmed || trimmed.startsWith('#')) {
				continue;
			}

			// Parse directive
			const colonIndex = trimmed.indexOf(':');
			if (colonIndex === -1) {
				continue;
			}

			const directive = trimmed.substring(0, colonIndex).trim().toLowerCase();
			const value = trimmed.substring(colonIndex + 1).trim();

			switch (directive) {
				case 'user-agent':
					// Check if this applies to all user agents
					inUserAgentBlock = true;
					appliesToAll = value === '*';
					break;

				case 'disallow':
					if (inUserAgentBlock && appliesToAll && value) {
						disallowedPaths.push(value);
					}
					break;

				case 'allow':
					// We're checking disallowed paths primarily
					// "Allow" can override "Disallow" but we'll keep it simple
					break;

				case 'crawl-delay':
					if (inUserAgentBlock && appliesToAll) {
						const delay = Number.parseInt(value, 10);
						if (!Number.isNaN(delay)) {
							crawlDelay = delay;
						}
					}
					break;

				case 'sitemap':
					sitemap = value;
					break;
			}
		}

		// Check if the current path is allowed
		const allowsCrawling = !isPathDisallowed(pathname, disallowedPaths);

		return Object.freeze({
			exists: true,
			allowsCrawling,
			crawlDelay,
			disallowedPaths: Object.freeze(disallowedPaths),
			sitemap,
		});
	} catch (error) {
		console.error('Error parsing robots.txt:', error);
		// If parsing fails, assume it exists but allow crawling (safe default)
		return createDefaultRobotsTxtInfo(true);
	}
}

/**
 * Checks if a path is disallowed by robots.txt rules
 * @param pathname - The path to check
 * @param disallowedPaths - Array of disallowed path patterns
 * @returns True if path is disallowed
 */
function isPathDisallowed(
	pathname: string,
	disallowedPaths: string[],
): boolean {
	for (const disallowed of disallowedPaths) {
		// Simple prefix matching (real robots.txt parsers are more complex)
		if (pathname.startsWith(disallowed)) {
			return true;
		}
	}
	return false;
}

/**
 * Creates default robots.txt info
 * @param exists - Whether robots.txt exists
 */
function createDefaultRobotsTxtInfo(exists: boolean): RobotsTxtInfo {
	return Object.freeze({
		exists,
		allowsCrawling: true, // Default to allowing if uncertain
		disallowedPaths: Object.freeze([]),
	});
}

export const RobotsTxtChecker = Object.freeze({
	fetchRobotsTxt,
});
