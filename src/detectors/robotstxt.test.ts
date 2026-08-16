/**
 * Unit tests for robots.txt checking
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	canonicalizeRobotsPath,
	parseRobotsTxt,
	RobotsTxtChecker,
} from './robotstxt';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('RobotsTxtChecker', () => {
	beforeEach(() => {
		mockFetch.mockReset();
	});

	describe('fetchRobotsTxt', () => {
		it('should return not exists when robots.txt is not found (404)', async () => {
			mockFetch.mockResolvedValue({
				ok: false,
				status: 404,
			});

			const result = await RobotsTxtChecker.fetchRobotsTxt(
				'https://example.com',
			);

			expect(result.exists).toBe(false);
			expect(result.allowsCrawling).toBe(true); // Safe default
		});

		it('should parse simple robots.txt', async () => {
			const robotsTxt = `
User-agent: *
Disallow: /admin
Disallow: /private
Crawl-delay: 1
Sitemap: https://example.com/sitemap.xml
			`.trim();

			mockFetch.mockResolvedValue({
				ok: true,
				text: async () => robotsTxt,
			});

			const result = await RobotsTxtChecker.fetchRobotsTxt(
				'https://example.com',
			);

			expect(result.exists).toBe(true);
			expect(result.allowsCrawling).toBe(true); // Root path is allowed
			expect(result.crawlDelay).toBe(1);
			expect(result.disallowedPaths).toContain('/admin');
			expect(result.disallowedPaths).toContain('/private');
			expect(result.sitemaps).toEqual(['https://example.com/sitemap.xml']);
		});

		it('should detect disallowed path', async () => {
			const robotsTxt = `
User-agent: *
Disallow: /admin
			`.trim();

			mockFetch.mockResolvedValue({
				ok: true,
				text: async () => robotsTxt,
			});

			const result = await RobotsTxtChecker.fetchRobotsTxt(
				'https://example.com/admin/users',
			);

			expect(result.exists).toBe(true);
			expect(result.allowsCrawling).toBe(false); // /admin is disallowed
		});

		it('propagates a fetch failure instead of reporting crawling allowed', async () => {
			// The previous default was `exists: false, allowsCrawling: true`,
			// commented "safe default" — but reporting that crawling is permitted
			// because the check failed is the least safe answer available. The
			// caller records the failure and the report states it.
			mockFetch.mockRejectedValue(new Error('Network error'));

			await expect(
				RobotsTxtChecker.fetchRobotsTxt('https://example.com'),
			).rejects.toThrow('Network error');
		});

		// Note: Timeout behavior is covered by "should handle fetch errors gracefully" test
		// Testing AbortController.timeout() requires complex mock setup that doesn't add value

		it('should ignore comments and empty lines', async () => {
			const robotsTxt = `
# This is a comment
User-agent: *

# Another comment
Disallow: /test
			`.trim();

			mockFetch.mockResolvedValue({
				ok: true,
				text: async () => robotsTxt,
			});

			const result = await RobotsTxtChecker.fetchRobotsTxt(
				'https://example.com',
			);

			expect(result.exists).toBe(true);
			expect(result.disallowedPaths).toHaveLength(1);
			expect(result.disallowedPaths).toContain('/test');
		});

		it('should match wildcard patterns', async () => {
			const robotsTxt = `
User-agent: *
Disallow: /private*
Disallow: /*.json$
			`.trim();

			mockFetch.mockResolvedValue({
				ok: true,
				text: async () => robotsTxt,
			});

			const blocked = await RobotsTxtChecker.fetchRobotsTxt(
				'https://example.com/private/data',
			);
			expect(blocked.allowsCrawling).toBe(false);

			const blockedJson = await RobotsTxtChecker.fetchRobotsTxt(
				'https://example.com/api/data.json',
			);
			expect(blockedJson.allowsCrawling).toBe(false);

			const allowed = await RobotsTxtChecker.fetchRobotsTxt(
				'https://example.com/api/data.jsonl',
			);
			expect(allowed.allowsCrawling).toBe(true);
		});

		it('should let the longest matching rule win, allow on ties', async () => {
			const robotsTxt = `
User-agent: *
Disallow: /shop
Allow: /shop/public
			`.trim();

			mockFetch.mockResolvedValue({
				ok: true,
				text: async () => robotsTxt,
			});

			const blocked = await RobotsTxtChecker.fetchRobotsTxt(
				'https://example.com/shop/checkout',
			);
			expect(blocked.allowsCrawling).toBe(false);

			const allowed = await RobotsTxtChecker.fetchRobotsTxt(
				'https://example.com/shop/public/catalog',
			);
			expect(allowed.allowsCrawling).toBe(true);
		});

		it('should honor grouped User-agent lines regardless of order', async () => {
			const robotsTxt = `
User-agent: *
User-agent: SomeBot
Disallow: /blocked
			`.trim();

			mockFetch.mockResolvedValue({
				ok: true,
				text: async () => robotsTxt,
			});

			const result = await RobotsTxtChecker.fetchRobotsTxt(
				'https://example.com/blocked/page',
			);
			expect(result.allowsCrawling).toBe(false);
		});

		it('should ignore agent-specific groups', async () => {
			const robotsTxt = `
User-agent: Googlebot
Disallow: /google-only

User-agent: *
Disallow: /everyone
			`.trim();

			mockFetch.mockResolvedValue({
				ok: true,
				text: async () => robotsTxt,
			});

			const result = await RobotsTxtChecker.fetchRobotsTxt(
				'https://example.com/google-only/page',
			);
			expect(result.allowsCrawling).toBe(true);
			expect(result.disallowedPaths).toEqual(['/everyone']);
		});

		it('should collect every sitemap', async () => {
			const robotsTxt = `
User-agent: *
Sitemap: https://example.com/map1.xml
Sitemap: https://example.com/map2.xml
			`.trim();

			mockFetch.mockResolvedValue({
				ok: true,
				text: async () => robotsTxt,
			});

			const result = await RobotsTxtChecker.fetchRobotsTxt(
				'https://example.com',
			);
			expect(result.sitemaps).toEqual([
				'https://example.com/map1.xml',
				'https://example.com/map2.xml',
			]);
		});

		it('should handle malformed robots.txt', async () => {
			const robotsTxt = 'This is not a valid robots.txt\nRandom content';

			mockFetch.mockResolvedValue({
				ok: true,
				text: async () => robotsTxt,
			});

			const result = await RobotsTxtChecker.fetchRobotsTxt(
				'https://example.com',
			);

			expect(result.exists).toBe(true);
			expect(result.allowsCrawling).toBe(true); // Safe default when parsing fails
		});
	});

	describe('percent-encoding before comparison', () => {
		/**
		 * Regression. RFC 9309 §2.2.2: octets outside ASCII "MUST be
		 * percent-encoded ... prior to comparison". `Disallow: /café` and a
		 * request for `/caf%C3%A9` name one resource, and only the unencoded
		 * spelling was refused — the encoded one, which is what `URL.pathname`
		 * hands over, came back allowed. Python's `RobotFileParser` refuses
		 * both.
		 */
		it('compares a rule and a path in their encoded form', () => {
			const robotsTxt = 'User-agent: *\nDisallow: /café\n';
			for (const path of ['/café', '/caf%C3%A9', '/caf%c3%a9']) {
				expect(
					parseRobotsTxt(robotsTxt, path).allowsCrawling,
					`path ${path} names the same resource the rule forbids`,
				).toBe(false);
			}
		});

		/** The other spelling of the same file: rule encoded, path not. */
		it('matches an already-encoded rule against an unencoded path', () => {
			const robotsTxt = 'User-agent: *\nDisallow: /caf%C3%A9\n';
			for (const path of ['/café', '/caf%C3%A9', '/caf%c3%a9']) {
				expect(parseRobotsTxt(robotsTxt, path).allowsCrawling, path).toBe(
					false,
				);
			}
		});

		/**
		 * A pattern's `*` and `$` are the RFC's special characters and survive
		 * encoding — only octets outside ASCII move, which is what Google's
		 * reference parser escapes and no more.
		 */
		it('leaves the special characters alone', () => {
			const robotsTxt = 'User-agent: *\nDisallow: /café/*.json$\n';
			expect(
				parseRobotsTxt(robotsTxt, '/caf%C3%A9/a.json').allowsCrawling,
			).toBe(false);
			expect(
				parseRobotsTxt(robotsTxt, '/caf%C3%A9/a.json?x=1').allowsCrawling,
			).toBe(true);
		});

		/**
		 * Regression. Longest-match-wins compares pattern lengths, and the two
		 * runtimes counted the raw pattern in different units. Encoding first
		 * settles it: RFC 9309 §2.2.2 measures "the most octets" of the encoded
		 * form, which is pure ASCII, so octets, characters and UTF-16 code
		 * units are one number.
		 */
		it('measures a pattern after it is encoded', () => {
			const robotsTxt = 'User-agent: *\nDisallow: /café\nAllow: /ca*e\n';
			expect(
				parseRobotsTxt(robotsTxt, '/café/page').allowsCrawling,
				'/caf%C3%A9 is ten octets and /ca*e is five',
			).toBe(false);

			const tied = 'User-agent: *\nDisallow: /café\nAllow: /ca*%C3%A9\n';
			expect(parseRobotsTxt(tied, '/café/page').allowsCrawling).toBe(true);
		});

		/** The reported patterns quote the file, not our canonical form. */
		it('reports the pattern the file actually carries', () => {
			const robotsTxt = 'User-agent: *\nDisallow: /café\n';
			expect(parseRobotsTxt(robotsTxt, '/café').disallowedPaths).toEqual([
				'/café',
			]);
		});

		/**
		 * Idempotence is what lets one function serve both entry points:
		 * `URL.pathname` hands over an encoded path and an MCP caller hands
		 * over whatever it typed, and encoding blindly would turn
		 * `/caf%C3%A9` into `/caf%25C3%25A9` and match nothing.
		 */
		it('canonicalizes to ASCII, and twice changes nothing', () => {
			for (const value of [
				'/café',
				'/caf%C3%A9',
				'/caf%c3%a9',
				'/*.json$',
				'/a%2Fb',
				'/100%',
				'/%zz',
				'/%',
				'/😀',
				'/',
			]) {
				const once = canonicalizeRobotsPath(value);
				expect(canonicalizeRobotsPath(once), value).toBe(once);
				// biome-ignore lint/suspicious/noControlCharactersInRegex: the assertion is that none survive
				expect(/^[\x00-\x7f]*$/.test(once), value).toBe(true);
			}
		});

		/** The examples RFC 9309 §2.2.2 and Google's parser print. */
		it('matches the reference examples', () => {
			expect(canonicalizeRobotsPath('/foo/bar/ツ')).toBe('/foo/bar/%E3%83%84');
			expect(canonicalizeRobotsPath('/foo/bar/%E3%83%84')).toBe(
				'/foo/bar/%E3%83%84',
			);
			expect(canonicalizeRobotsPath('/SanJoséSellers')).toBe(
				'/SanJos%C3%A9Sellers',
			);
			expect(canonicalizeRobotsPath('%aa')).toBe('%AA');
			// A truncated escape is not one, and is left as the literal it is.
			expect(canonicalizeRobotsPath('/a%2')).toBe('/a%2');
		});
	});
});
