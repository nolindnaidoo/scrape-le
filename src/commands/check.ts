/**
 * Check URL command implementation
 */

import * as path from 'node:path';
import * as vscode from 'vscode';
import { getConfiguration } from '../config/config';
import { closeBrowser, createBrowser } from '../scraper/browser';
import { checkPageScrapeability } from '../scraper/checker';
import { ensureBrowserInstalled } from '../scraper/install';
import type { CheckOptions, Notifier, StatusBar } from '../types';
import { logCheckResult, showOutput } from '../ui/output';
import { formatErrorForUser } from '../utils/errorHandling';
import { isValidUrl, normalizeUrl } from '../utils/url';

/**
 * Registers the check URL command
 */
export function registerCheckUrlCommand(
	context: vscode.ExtensionContext,
	deps: Readonly<{
		notifier: Notifier;
		statusBar: StatusBar;
	}>,
): void {
	const command = vscode.commands.registerCommand(
		'scrape-le.checkUrl',
		async () => {
			// Prompt for URL
			const urlInput = await vscode.window.showInputBox({
				prompt: 'Enter URL to check',
				placeHolder: 'https://example.com',
				validateInput: (value: string) => {
					if (!value || value.trim() === '') {
						return 'URL cannot be empty';
					}

					const normalized = normalizeUrl(value);
					if (!isValidUrl(normalized)) {
						return 'Please enter a valid URL';
					}

					return null;
				},
			});

			if (!urlInput) {
				// User cancelled
				return;
			}

			// Normalize the URL
			const url = normalizeUrl(urlInput);

			// Execute the check
			await executeCheck(url, deps, context);
		},
	);

	context.subscriptions.push(command);
}

/**
 * Executes a scrapeability check for a given URL
 */
export async function executeCheck(
	url: string,
	deps: Readonly<{
		notifier: Notifier;
		statusBar: StatusBar;
	}>,
	_context: vscode.ExtensionContext,
): Promise<void> {
	// Check if browser is installed
	const browserAvailable = await ensureBrowserInstalled();
	if (!browserAvailable) {
		deps.notifier.warn(
			'Chromium browser is required. Please install it to use Scrape-LE.',
		);
		return;
	}

	const config = getConfiguration();

	// Build check options from configuration
	const workspacePath =
		vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
	const screenshotPath = path.isAbsolute(config.screenshot.path)
		? config.screenshot.path
		: path.join(workspacePath, config.screenshot.path);

	const checkOptions: CheckOptions = Object.freeze({
		timeout: config.browser.timeout,
		viewport: config.browser.viewport,
		userAgent: config.browser.userAgent,
		screenshotEnabled: config.screenshot.enabled,
		screenshotPath,
		screenshotFormat: config.screenshot.format,
		screenshotQuality: config.screenshot.quality,
		checkConsoleErrors: config.checkConsoleErrors,
		detections: config.detections,
	});

	// Show progress
	await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: 'Scrape-LE',
			cancellable: false,
		},
		async (progress) => {
			progress.report({ message: `Checking ${url}...` });

			// Update status bar
			deps.statusBar.show(
				'$(sync~spin) Checking...',
				'Checking URL scrapeability',
			);

			let browser = null;

			try {
				// Launch browser
				progress.report({ message: 'Launching browser...' });
				browser = await createBrowser();

				// Perform the check
				progress.report({ message: 'Loading page...' });
				const result = await checkPageScrapeability(browser, url, checkOptions);

				// Log result to output channel
				logCheckResult(result);

				// Show result in status bar
				if (result.success) {
					deps.statusBar.show(
						`$(check) Reachable (${result.loadTimeMs}ms)`,
						`${result.title} - HTTP ${result.statusCode}`,
					);

					const errorCount = result.consoleErrors.length;
					if (errorCount > 0) {
						deps.notifier.warn(
							`✓ Page reachable but found ${errorCount} console error(s). Check output for details.`,
						);
					} else {
						deps.notifier.info(`✓ Page is reachable and scrapeable`);
					}
				} else {
					deps.statusBar.show('$(x) Failed', result.error || 'Check failed');
					deps.notifier.error(`✗ Failed to reach page: ${result.error}`);
				}

				// Show output channel
				showOutput();
			} catch (error) {
				const errorMessage = formatErrorForUser(error);
				deps.statusBar.show('$(x) Error', errorMessage);
				deps.notifier.error(errorMessage);

				// Log to output
				showOutput();
			} finally {
				// Clean up browser
				if (browser) {
					await closeBrowser(browser);
				}

				// Reset status bar after a delay
				setTimeout(() => {
					deps.statusBar.show(
						'$(globe) Scrape-LE',
						'Click to check URL scrapeability',
					);
				}, 5000);
			}
		},
	);
}
