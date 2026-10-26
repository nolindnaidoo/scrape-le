/**
 * Check URL command implementation
 */

import * as path from 'node:path';
import * as vscode from 'vscode';
import { getConfiguration } from '../config/config';
import { closeBrowser, createBrowser } from '../scraper/browser';
import { checkPageScrapeability } from '../scraper/checker';
import { ensureBrowserInstalled } from '../scraper/install';
import { retryWithUserAgents, shouldRetry } from '../scraper/retry';
import type { CheckOptions, CheckResult, Notifier, StatusBar } from '../types';
import { logCheckResult, showOutput } from '../ui/output';
import type { RatingPrompt } from '../ui/ratingPrompt';
import { formatErrorForUser } from '../utils/errorHandling';
import { normalizeUrl, validateUrl } from '../utils/url';
import { guarded } from './guard';

/**
 * Registers the check URL command
 */
export function registerCheckUrlCommand(
	context: vscode.ExtensionContext,
	deps: Readonly<{
		notifier: Notifier;
		statusBar: StatusBar;
		ratingPrompt: RatingPrompt;
	}>,
): void {
	const command = vscode.commands.registerCommand(
		'scrape-le.checkUrl',
		guarded(deps.notifier, async () => {
			// Prompt for URL
			const urlInput = await vscode.window.showInputBox({
				prompt: vscode.l10n.t('Enter URL to check'),
				placeHolder: 'https://example.com',
				validateInput: (value: string) => {
					if (!value || value.trim() === '') {
						return vscode.l10n.t('URL cannot be empty');
					}

					const normalized = normalizeUrl(value);
					if (!validateUrl(normalized)) {
						return vscode.l10n.t('Please enter a valid URL');
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
		}),
	);

	context.subscriptions.push(command);
}

/**
 * The toast for a page that loaded. "Reachable and scrapeable" was shown
 * whenever the page loaded without console errors, with anti-bot vendors,
 * a login wall, a robots.txt refusal or a 403 sitting in the report below
 * it; the detectors cannot prove scrapeability, only name what blocks it,
 * so the toast now names what they found or says that nothing was found.
 */
function announceSuccess(result: CheckResult, notifier: Notifier): void {
	const blockers = blockingSignals(result);
	if (blockers.length > 0) {
		notifier.warn(
			vscode.l10n.t(
				'✓ Page is reachable, but scraping may be blocked: {0}. See output for details.',
				blockers.join(', '),
			),
		);
		return;
	}
	const errorCount = result.consoleErrors.length;
	if (errorCount > 0) {
		notifier.warn(
			vscode.l10n.t(
				'✓ Page is reachable but found {0} console error(s). Check output for details.',
				errorCount,
			),
		);
		return;
	}
	notifier.info(
		vscode.l10n.t(
			'✓ Page is reachable and nothing found would block a scraper',
		),
	);
}

/**
 * Everything in a result that would stop or limit a scraper, as the report
 * lists it: the status, each detection that fired, and any detection that
 * could not run, because a check that did not run proves nothing.
 */
function blockingSignals(result: CheckResult): string[] {
	const signals: string[] = [];
	if (result.statusCode !== null && result.statusCode >= 400) {
		signals.push(vscode.l10n.t('HTTP {0}', result.statusCode));
	}
	const detections = result.detections;
	if (!detections) return signals;
	const antiBot = detections.antiBot;
	if (
		antiBot &&
		(antiBot.cloudflare ||
			antiBot.recaptcha ||
			antiBot.hcaptcha ||
			antiBot.datadome ||
			antiBot.perimeterx)
	) {
		signals.push(vscode.l10n.t('anti-bot measures'));
	}
	if (detections.rateLimit?.detected) {
		signals.push(vscode.l10n.t('rate limiting'));
	}
	if (detections.robotsTxt && !detections.robotsTxt.allowsCrawling) {
		signals.push(vscode.l10n.t('robots.txt'));
	}
	if (detections.authentication?.required) {
		signals.push(vscode.l10n.t('authentication'));
	}
	if (detections.failures && detections.failures.length > 0) {
		signals.push(vscode.l10n.t('a detection that could not run'));
	}
	return signals;
}

/**
 * Executes a scrapeability check for a given URL
 */
export async function executeCheck(
	url: string,
	deps: Readonly<{
		notifier: Notifier;
		statusBar: StatusBar;
		ratingPrompt: RatingPrompt;
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
		robotsAgent: config.robotsAgent || undefined,
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
			progress.report({ message: vscode.l10n.t('Checking {0}...', url) });

			// Update status bar
			deps.statusBar.show(
				'$(sync~spin) Checking...',
				'Checking URL scrapeability',
			);

			let browser = null;

			try {
				// Launch browser
				progress.report({ message: vscode.l10n.t('Launching browser...') });
				browser = await createBrowser();

				// Perform the check
				progress.report({ message: vscode.l10n.t('Loading page...') });
				const firstAttempt = await checkPageScrapeability(
					browser,
					url,
					checkOptions,
				);

				// A blocked or failed check says the page resisted, not what would
				// have worked. Re-running under a few common agents answers that,
				// and only runs when the user asked for it — each retry is a full
				// page load.
				const attempts =
					config.retry.userAgents && shouldRetry(firstAttempt)
						? await retryWithUserAgents(browser, url, checkOptions, (label) =>
								progress.report({
									message: vscode.l10n.t('Retrying as {0}...', label),
								}),
							)
						: undefined;

				const result: CheckResult =
					attempts && attempts.length > 0
						? { ...firstAttempt, userAgentAttempts: attempts }
						: firstAttempt;

				// Log result to output channel
				logCheckResult(result);

				// Show result in status bar
				if (result.success) {
					deps.statusBar.show(
						`$(check) Reachable (${result.loadTimeMs}ms)`,
						`${result.title} - HTTP ${result.statusCode}`,
					);
					announceSuccess(result, deps.notifier);
				}
				if (!result.success) {
					deps.statusBar.show('$(x) Failed', result.error || 'Check failed');
					// result.error is optional; the template literal this replaced
					// rendered the string "undefined" when it was absent. The status
					// bar line directly above already falls back to 'Check failed'.
					deps.notifier.error(
						vscode.l10n.t(
							'✗ Failed to reach page: {0}',
							result.error || 'Check failed',
						),
					);
				}

				// Show output channel
				showOutput();

				// A check that could not reach the page still produced a report,
				// but it is not the moment to ask anyone how they like the tool.
				if (result.success) {
					// Not awaited: it resolves when the toast is answered, and a command that
					// waited on that would stay pending for as long as the toast is ignored.
					void deps.ratingPrompt.recordSuccess();
				}
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

				// The idle text comes back after a cooldown; the status bar owns
				// the timer so a check started meanwhile is not reset mid-run.
				deps.statusBar.resetAfter(5000);
			}
		},
	);
}
