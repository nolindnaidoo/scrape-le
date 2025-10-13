/**
 * Detection module exports and aggregation
 */

import type { Page, Response } from 'playwright-core';
import type { CheckOptions, DetectionResults } from '../types';
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
	} = {};

	// Run detections in parallel for efficiency
	const promises: Promise<void>[] = [];

	// Rate limit detection (fast - header parsing only)
	if (options.detections.rateLimit) {
		promises.push(
			RateLimitDetector.detectRateLimiting(response)
				.then((result) => {
					detections.rateLimit = result;
				})
				.catch((error) => {
					console.error('Rate limit detection failed:', error);
				}),
		);
	}

	// Anti-bot detection (moderate - page analysis)
	if (options.detections.antiBot) {
		promises.push(
			AntiBotDetector.detectAntiBotMeasures(page, response)
				.then((result) => {
					detections.antiBot = result;
				})
				.catch((error) => {
					console.error('Anti-bot detection failed:', error);
				}),
		);
	}

	// Authentication detection (moderate - page analysis)
	if (options.detections.authentication) {
		const statusCode = response?.status() ?? null;
		promises.push(
			AuthenticationDetector.detectAuthenticationWall(page, statusCode)
				.then((result) => {
					detections.authentication = result;
				})
				.catch((error) => {
					console.error('Authentication detection failed:', error);
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
					console.error('robots.txt detection failed:', error);
				}),
		);
	}

	// Wait for all detections to complete
	await Promise.all(promises);

	return Object.freeze(detections);
}

// Re-export individual detectors for testing
export { AntiBotDetector } from './antibot';
export { AuthenticationDetector } from './authentication';
export { RateLimitDetector } from './ratelimit';
export { RobotsTxtChecker } from './robotstxt';
