/**
 * Detection module exports and aggregation
 */

import type { Page, Response } from 'playwright-core';
import type {
	CheckOptions,
	DetectionFailure,
	DetectionResults,
} from '../types';
import { AntiBotDetector } from './antibot';
import { AuthenticationDetector } from './authentication';
import { RateLimitDetector } from './ratelimit';
import { RobotsTxtChecker } from './robotstxt';

/**
 * Runs all enabled detections and aggregates results
 * @param page - Playwright page object
 * @param response - Playwright response object
 * @param url - The URL being checked
 * @param options - Check options with detection settings
 * @returns Aggregated detection results
 */
export async function runDetections(
	page: Page,
	response: Response | null,
	url: string,
	options: CheckOptions,
): Promise<DetectionResults> {
	const detections: {
		antiBot?: DetectionResults['antiBot'];
		rateLimit?: DetectionResults['rateLimit'];
		robotsTxt?: DetectionResults['robotsTxt'];
		authentication?: DetectionResults['authentication'];
		failures?: DetectionFailure[];
	} = {};

	// Collected rather than logged: a detector that threw must show up in the
	// report, not only in a console the user never opens.
	const failures: DetectionFailure[] = [];
	const recordFailure = (
		detection: DetectionFailure['detection'],
		error: unknown,
	): void => {
		failures.push({
			detection,
			message: error instanceof Error ? error.message : String(error),
		});
	};

	// Run detections in parallel for efficiency
	const promises: Promise<void>[] = [];

	// Rate limit detection (fast - header parsing only)
	if (options.detections.rateLimit) {
		promises.push(
			RateLimitDetector.detectRateLimit(response)
				.then((result) => {
					detections.rateLimit = result;
				})
				.catch((error) => {
					recordFailure('rateLimit', error);
				}),
		);
	}

	// Anti-bot detection (moderate - page analysis)
	if (options.detections.antiBot) {
		promises.push(
			AntiBotDetector.detectAntiBot(page, response)
				.then((result) => {
					detections.antiBot = result;
				})
				.catch((error) => {
					recordFailure('antiBot', error);
				}),
		);
	}

	// Authentication detection (moderate - page analysis)
	if (options.detections.authentication) {
		const statusCode = response?.status() ?? null;
		promises.push(
			AuthenticationDetector.detectAuthentication(page, statusCode)
				.then((result) => {
					detections.authentication = result;
				})
				.catch((error) => {
					recordFailure('authentication', error);
				}),
		);
	}

	// robots.txt detection (network request - run separately)
	if (options.detections.robotsTxt) {
		promises.push(
			RobotsTxtChecker.fetchRobotsTxt(url)
				.then((result) => {
					detections.robotsTxt = result;
				})
				.catch((error) => {
					recordFailure('robotsTxt', error);
				}),
		);
	}

	// Wait for all detections to complete
	await Promise.all(promises);

	if (failures.length > 0) detections.failures = failures;

	return Object.freeze(detections);
}

// Re-export individual detectors for testing
export { AntiBotDetector } from './antibot';
export { AuthenticationDetector } from './authentication';
export { RateLimitDetector } from './ratelimit';
export { RobotsTxtChecker } from './robotstxt';
