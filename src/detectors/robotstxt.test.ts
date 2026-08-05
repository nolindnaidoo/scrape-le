/**
 * Unit tests for robots.txt checking
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RobotsTxtChecker } from './robotstxt';

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
});
