/**
 * Core scrapeability checking logic
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Browser } from 'playwright-core';
import { runDetections } from '../detectors';
import type { CheckOptions, CheckResult, ConsoleMessage } from '../types';
import {
	extractErrorMessage,
	sanitizeErrorMessage,
} from '../utils/errorHandling';
import { convertUrlToFilename } from '../utils/url';

/**
 * Performs scrapeability check on a URL
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

		// Navigate to the URL. 'load' instead of 'networkidle': pages with
		// long-polling/analytics never go idle and would burn the whole
		// timeout and fail the check despite loading fine.
		const response = await page.goto(url, {
			timeout: options.timeout,
			waitUntil: 'load',
		});

		// Best-effort settle so SPA-rendered content (login forms, captcha
		// widgets) is present for the detectors; never fails the check.
		try {
			await page.waitForLoadState('networkidle', {
				timeout: Math.min(5000, options.timeout),
			});
		} catch {
			// page kept making requests — proceed with what we have
		}

		// Get status code
		statusCode = response?.status() ?? null;

		// Get page title
		title = await page.title();

		// Take screenshot if enabled
		if (options.screenshotEnabled) {
			screenshotPath = await captureScreenshot(page, url, options);
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

		// Build success result
		return Object.freeze({
			success: true,
			url,
			statusCode,
			title,
			loadTimeMs,
			screenshotPath,
			consoleErrors: Object.freeze(consoleMessages.map((msg) => msg.text)),
			detections,
		});
	} catch (error) {
		const loadTimeMs = Date.now() - startTime;
		const errorMessage = sanitizeErrorMessage(extractErrorMessage(error));

		// Build error result
		return Object.freeze({
			success: false,
			url,
			statusCode,
			title: title || 'N/A',
			loadTimeMs,
			screenshotPath,
			consoleErrors: Object.freeze(consoleMessages.map((msg) => msg.text)),
			error: errorMessage,
		});
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
 * Captures screenshot of the page honoring format and quality settings
 * (quality applies to jpeg only — Playwright rejects it for png)
 */
async function captureScreenshot(
	page: {
		screenshot: (options: {
			path: string;
			fullPage: boolean;
			type: 'png' | 'jpeg';
			quality?: number;
		}) => Promise<Buffer | undefined>;
	},
	url: string,
	options: Pick<
		CheckOptions,
		'screenshotPath' | 'screenshotFormat' | 'screenshotQuality'
	>,
): Promise<string> {
	try {
		const extension = options.screenshotFormat === 'jpeg' ? 'jpg' : 'png';
		const filename = `${convertUrlToFilename(url)}.${extension}`;
		const fullPath = path.join(options.screenshotPath, filename);

		// Ensure directory exists
		await fs.mkdir(options.screenshotPath, { recursive: true });

		await page.screenshot({
			path: fullPath,
			fullPage: true,
			type: options.screenshotFormat,
			...(options.screenshotFormat === 'jpeg'
				? { quality: options.screenshotQuality }
				: {}),
		});

		return fullPath;
	} catch (error) {
		// Screenshot is non-critical, log but continue
		console.error('Failed to capture screenshot:', error);
		return '';
	}
}
