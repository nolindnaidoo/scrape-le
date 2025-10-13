/**
 * Unit tests for rate limiting detection
 */

import type { Response } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { RateLimitDetector } from './ratelimit';

describe('RateLimitDetector', () => {
	describe('detectRateLimiting', () => {
		it('should return not detected when response is null', async () => {
			const result = await RateLimitDetector.detectRateLimiting(null);

			expect(result.detected).toBe(false);
		});

		it('should detect X-RateLimit headers', async () => {
			const mockResponse = {
				headers: () => ({
					'x-ratelimit-limit': '100',
					'x-ratelimit-remaining': '95',
					'x-ratelimit-reset': '1234567890',
				}),
			} as unknown as Response;

			const result = await RateLimitDetector.detectRateLimiting(mockResponse);

			expect(result.detected).toBe(true);
			expect(result.limit).toBe('100');
			expect(result.remaining).toBe('95');
			expect(result.reset).toBe('1234567890');
		});

		it('should detect RateLimit headers without X- prefix', async () => {
			const mockResponse = {
				headers: () => ({
					'ratelimit-limit': '50',
					'ratelimit-remaining': '10',
				}),
			} as unknown as Response;

			const result = await RateLimitDetector.detectRateLimiting(mockResponse);

			expect(result.detected).toBe(true);
			expect(result.limit).toBe('50');
			expect(result.remaining).toBe('10');
		});

		it('should detect Retry-After header', async () => {
			const mockResponse = {
				headers: () => ({
					'retry-after': '120',
				}),
			} as unknown as Response;

			const result = await RateLimitDetector.detectRateLimiting(mockResponse);

			expect(result.detected).toBe(true);
			expect(result.retryAfter).toBe('120');
		});

		it('should return not detected when no rate limit headers present', async () => {
			const mockResponse = {
				headers: () => ({
					'content-type': 'text/html',
					server: 'nginx',
				}),
			} as unknown as Response;

			const result = await RateLimitDetector.detectRateLimiting(mockResponse);

			expect(result.detected).toBe(false);
		});

		it('should handle errors gracefully', async () => {
			const mockResponse = {
				headers: () => {
					throw new Error('Headers error');
				},
			} as unknown as Response;

			const result = await RateLimitDetector.detectRateLimiting(mockResponse);

			expect(result.detected).toBe(false);
		});
	});
});
