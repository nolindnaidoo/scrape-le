/**
 * Rate limiting detection from HTTP headers
 */

import type { Response } from 'playwright-core';
import type { RateLimitInfo } from '../types';

/**
 * Detects rate limiting information from response headers
 */
export async function detectRateLimit(
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

		// HTTP 429 is rate limiting even without advertised headers
		const rateLimited = readStatus(response) === 429;

		const hasRateLimitHeaders = !!(limit || remaining || reset || retryAfter);
		if (!hasRateLimitHeaders && !rateLimited) {
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
		// Rethrown rather than swallowed into a default result. Returning the
		// all-clear on error made a crashed check indistinguishable from a clean
		// one — the report stated "Not detected" for a detection that never ran.
		// runDetections records the failure and the report shows it.
		throw error;
	}
}

function readStatus(response: Response): number | null {
	try {
		return response.status();
	} catch {
		return null;
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
	detectRateLimit,
});
