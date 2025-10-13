/**
 * Browser management using Playwright
 */
import { type Browser, chromium } from 'playwright-core';
import { createEnhancedError } from '../utils/errorHandling';

/**
 * Creates and launches a Playwright browser instance
 */
export async function createBrowser(): Promise<Browser> {
	try {
		const browser = await chromium.launch({
			headless: true,
			args: [
				'--no-sandbox',
				'--disable-setuid-sandbox',
				'--disable-dev-shm-usage',
				'--disable-accelerated-2d-canvas',
				'--disable-gpu',
			],
		});

		return browser;
	} catch (error) {
		throw createEnhancedError(
			'Failed to launch browser. Is Chromium installed?',
			{
				originalError: error,
			},
		);
	}
}

/**
 * Closes a browser instance gracefully
 */
export async function closeBrowser(browser: Browser): Promise<void> {
	try {
		await browser.close();
	} catch (error) {
		// Log but don't throw - closing is best effort
		console.error('Error closing browser:', error);
	}
}

/**
 * Checks if Playwright browser is available
 */
export async function isBrowserAvailable(): Promise<boolean> {
	try {
		const browser = await createBrowser();
		await closeBrowser(browser);
		return true;
	} catch {
		return false;
	}
}

export const BrowserManager = Object.freeze({
	createBrowser,
	closeBrowser,
	isBrowserAvailable,
});
