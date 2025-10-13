/**
 * Core scrapeability checking logic
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Browser } from 'playwright-core';
import { runDetections } from '../detectors';
import type { CheckOptions, CheckResult, ConsoleMessage } from '../types';
import { getErrorMessage } from '../utils/errorHandling';
import { urlToFilename } from '../utils/url';

/**
 * Performs a scrapeability check on a URL
 */
export async function checkPageScrapeability(
	browser: Browser,
	url: string,
	options: CheckOptions,
): Promise<CheckResult> {
	const startTime = Date.now();
	const consoleMessages: ConsoleMessage[] = [];
	let statusCode: number | null = null;
	let title = '';
	let screenshotPath: string | undefined;
	let page = null;

	try {
		// Create a new page with configured viewport
		page = await browser.newPage({
			viewport: {
				width: options.viewport.width,
				height: options.viewport.height,
			},
		});

		// Set up console error listener if enabled
		if (options.checkConsoleErrors) {
			page.on('console', (msg) => {
				const type = msg.type();
				if (type === 'error' || type === 'warning') {
					consoleMessages.push({
						type: type as 'error' | 'warning',
						text: msg.text(),
						timestamp: Date.now(),
					});
				}
			});

			// Also capture page errors
			page.on('pageerror', (error) => {
				consoleMessages.push({
					type: 'error',
					text: error.message,
					timestamp: Date.now(),
				});
			});
		}

		// Navigate to the URL
		const response = await page.goto(url, {
			timeout: options.timeout,
			waitUntil: 'networkidle',
		});

		// Get status code
		statusCode = response?.status() ?? null;

		// Get page title
		title = await page.title();

		// Take screenshot if enabled
		if (options.screenshotEnabled) {
			screenshotPath = await captureScreenshot(
				page,
				url,
				options.screenshotPath,
			);
		}

		// Run detections if any are enabled
		const hasDetectionsEnabled =
			options.detections.antiBot ||
			options.detections.rateLimit ||
			options.detections.robotsTxt ||
			options.detections.authentication;

		const detections = hasDetectionsEnabled
			? await runDetections(page, response, url, options)
			: undefined;

		const loadTimeMs = Date.now() - startTime;

		// Build result
		const result: CheckResult = Object.freeze({
			success: true,
			url,
			statusCode,
			title,
			loadTimeMs,
			screenshotPath,
			consoleErrors: Object.freeze(consoleMessages.map((msg) => msg.text)),
			detections,
		});

		return result;
	} catch (error) {
		const loadTimeMs = Date.now() - startTime;
		const errorMessage = getErrorMessage(error);

		const result: CheckResult = Object.freeze({
			success: false,
			url,
			statusCode,
			title: title || 'N/A',
			loadTimeMs,
			screenshotPath,
			consoleErrors: Object.freeze(consoleMessages.map((msg) => msg.text)),
			error: errorMessage,
		});

		return result;
	} finally {
		// Ensure page is always closed, even on error
		if (page) {
			try {
				await page.close();
			} catch (closeError) {
				// Log but don't throw - closing is best effort
				console.error('Error closing page:', closeError);
			}
		}
	}
}

/**
 * Captures a screenshot of the page
 */
async function captureScreenshot(
	page: {
		screenshot: (options: {
			path: string;
			fullPage: boolean;
		}) => Promise<Buffer | undefined>;
	},
	url: string,
	screenshotBasePath: string,
): Promise<string> {
	try {
		// Create filename from URL
		const filename = `${urlToFilename(url)}.png`;
		const fullPath = path.join(screenshotBasePath, filename);

		// Ensure directory exists
		await fs.mkdir(screenshotBasePath, { recursive: true });

		// Take full page screenshot
		await page.screenshot({
			path: fullPath,
			fullPage: true,
		});

		return fullPath;
	} catch (error) {
		// Screenshot is non-critical, log but continue
		console.error('Failed to capture screenshot:', error);
		return '';
	}
}

export const Checker = Object.freeze({
	checkPageScrapeability,
});
