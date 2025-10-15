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
			expect(result.sitemap).toBe('https://example.com/sitemap.xml');
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

		it('should handle fetch errors gracefully', async () => {
			mockFetch.mockRejectedValue(new Error('Network error'));

			const result = await RobotsTxtChecker.fetchRobotsTxt(
				'https://example.com',
			);

			expect(result.exists).toBe(false);
			expect(result.allowsCrawling).toBe(true); // Safe default
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
