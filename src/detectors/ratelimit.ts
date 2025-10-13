/**
 * Rate limiting detection from HTTP headers
 */

import type { Response } from 'playwright-core';
import type { RateLimitInfo } from '../types';

/**
 * Detects rate limiting information from response headers
 * @param response - Playwright response object
 * @returns Rate limit information or default if not detected
 */
export async function detectRateLimiting(
	response: Response | null,
): Promise<RateLimitInfo> {
	if (!response) {
		return createDefaultRateLimitInfo();
	}

	try {
		const headers = response.headers();

		// Check for standard rate limit headers
		const limit = headers['x-ratelimit-limit'] || headers['ratelimit-limit'];
		const remaining =
			headers['x-ratelimit-remaining'] || headers['ratelimit-remaining'];
		const reset = headers['x-ratelimit-reset'] || headers['ratelimit-reset'];
		const retryAfter = headers['retry-after'];

		// If any rate limit header exists, consider it detected
		const detected = !!(limit || remaining || reset || retryAfter);

		if (!detected) {
			return createDefaultRateLimitInfo();
		}

		return Object.freeze({
			detected: true,
			limit: limit || undefined,
			remaining: remaining || undefined,
			reset: reset || undefined,
			retryAfter: retryAfter || undefined,
		});
	} catch (error) {
		// If header reading fails, return default
		console.error('Error detecting rate limits:', error);
		return createDefaultRateLimitInfo();
	}
}

/**
 * Creates default rate limit info (not detected)
 */
function createDefaultRateLimitInfo(): RateLimitInfo {
	return Object.freeze({
		detected: false,
	});
}

export const RateLimitDetector = Object.freeze({
	detectRateLimiting,
});
