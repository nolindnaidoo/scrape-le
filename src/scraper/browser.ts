/**
 * Browser management using Playwright
 */
import { type Browser, chromium } from 'playwright-core';
import { createEnhancedError } from '../utils/errorHandling';

/**
 * Flags that are purely about resource use in a headless context. None of
 * these weaken the browser's isolation from the page it loads.
 */
const RESOURCE_ARGS: readonly string[] = Object.freeze([
	'--disable-dev-shm-usage',
	'--disable-accelerated-2d-canvas',
	'--disable-gpu',
]);

/**
 * Sandbox opt-out, used only as a fallback.
 *
 * This extension points a real browser at whatever URL the user supplies, so
 * the Chromium sandbox is the boundary between a hostile page and the user's
 * machine. It used to be disabled unconditionally — `--no-sandbox` was passed
 * on every launch — which is the usual workaround for container and CI images
 * where the sandbox cannot initialise, but it is not needed on a normal
 * desktop and removes the containment exactly where arbitrary pages are
 * loaded.
 *
 * The launch now attempts the sandboxed configuration first and only falls
 * back if Chromium genuinely refuses to start, so restricted environments keep
 * working without every other user paying for them.
 */
const SANDBOX_OPT_OUT: readonly string[] = Object.freeze([
	'--no-sandbox',
	'--disable-setuid-sandbox',
]);

/** True when the browser is running without its sandbox. */
let launchedUnsandboxed = false;

export function isRunningUnsandboxed(): boolean {
	return launchedUnsandboxed;
}

/**
 * Creates and launches a Playwright browser instance.
 */
export async function createBrowser(): Promise<Browser> {
	try {
		const browser = await chromium.launch({
			headless: true,
			args: [...RESOURCE_ARGS],
		});
		launchedUnsandboxed = false;
		return browser;
	} catch (sandboxedError) {
		// Environments that cannot run the sandbox (containers, some CI images,
		// hardened kernels) fail at launch. Retry without it rather than leaving
		// the extension unusable there.
		try {
			const browser = await chromium.launch({
				headless: true,
				args: [...RESOURCE_ARGS, ...SANDBOX_OPT_OUT],
			});
			launchedUnsandboxed = true;
			return browser;
		} catch {
			throw createEnhancedError(
				'Failed to launch browser. Is Chromium installed?',
				{
					originalError: sandboxedError,
				},
			);
		}
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
