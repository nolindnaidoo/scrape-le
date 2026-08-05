/**
 * Browser installation utilities for Scrape-LE
 */
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { isBrowserAvailable } from './browser';

/**
 * The exact CLI shipped with the bundled playwright-core, so the
 * downloaded Chromium build always matches the library version.
 */
function resolvePlaywrightCli(): string {
	return path.join(path.dirname(require.resolve('playwright-core')), 'cli.js');
}

/**
 * Manual command pinned to the shipped playwright-core version — an
 * unpinned install can fetch a Chromium build the library won't find.
 */
function manualInstallCommand(): string {
	try {
		const { version } = require('playwright-core/package.json') as {
			version: string;
		};
		return `npx playwright-core@${version} install chromium`;
	} catch {
		return 'npx playwright-core install chromium';
	}
}

/**
 * Checks if browser is installed and prompts user to install if not
 * Returns true if browser is available, false otherwise
 */
export async function ensureBrowserInstalled(): Promise<boolean> {
	const isAvailable = await isBrowserAvailable();

	if (isAvailable) {
		return true;
	}

	// Bound once and compared by reference. showWarningMessage returns the label
	// that was clicked, so a localized label compared against an English literal
	// silently reads as "dismissed" in every other language — here that would
	// mean the install prompt could never be accepted outside English.
	const installLabel = vscode.l10n.t('Install Chromium');
	const cancelLabel = vscode.l10n.t('Cancel');
	const learnMoreLabel = vscode.l10n.t('Learn More');

	const choice = await vscode.window.showWarningMessage(
		vscode.l10n.t(
			'Scrape-LE requires Chromium browser to be installed. Would you like to install it now? (This is a one-time setup, ~130MB download)',
		),
		installLabel,
		cancelLabel,
		learnMoreLabel,
	);

	if (choice === installLabel) {
		return await installBrowser();
	}

	if (choice === learnMoreLabel) {
		await vscode.env.openExternal(
			vscode.Uri.parse('https://playwright.dev/docs/browsers#install-browsers'),
		);
		return false;
	}

	return false;
}

/**
 * Installs the Chromium browser by running the bundled playwright-core
 * CLI in a child Node process (the VS Code binary with
 * ELECTRON_RUN_AS_NODE). Async — the extension host stays responsive,
 * unlike the previous execSync('npx playwright install') which froze
 * the UI for the whole download and depended on npx existing.
 */
async function installBrowser(): Promise<boolean> {
	return await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: vscode.l10n.t('Installing Chromium'),
			cancellable: false,
		},
		async (progress) => {
			try {
				progress.report({
					message: vscode.l10n.t('Downloading Chromium browser...'),
				});

				await runPlaywrightInstall();

				progress.report({ message: vscode.l10n.t('Installation complete!') });

				// Verify installation
				const isNowAvailable = await isBrowserAvailable();

				if (isNowAvailable) {
					vscode.window.showInformationMessage(
						vscode.l10n.t('✅ Chromium installed successfully!'),
					);
					return true;
				}

				vscode.window.showErrorMessage(
					vscode.l10n.t(
						'❌ Chromium installation completed but browser is not available. Please try running "{0}" manually.',
						manualInstallCommand(),
					),
				);
				return false;
			} catch (error) {
				const errorMessage =
					error instanceof Error ? error.message : 'Unknown error';
				vscode.window.showErrorMessage(
					vscode.l10n.t(
						'❌ Failed to install Chromium: {0}. Please run "{1}" manually.',
						errorMessage,
						manualInstallCommand(),
					),
				);
				return false;
			}
		},
	);
}

function runPlaywrightInstall(): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(
			process.execPath,
			[resolvePlaywrightCli(), 'install', 'chromium'],
			{
				env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
				stdio: ['ignore', 'ignore', 'pipe'],
			},
		);

		let stderrTail = '';
		child.stderr.on('data', (chunk: Buffer) => {
			stderrTail = (stderrTail + chunk.toString()).slice(-500);
		});

		child.on('error', reject);
		child.on('close', (code) => {
			if (code === 0) {
				resolve();
			} else {
				reject(
					new Error(
						`playwright-core install exited with code ${code}${stderrTail ? `: ${stderrTail.trim()}` : ''}`,
					),
				);
			}
		});
	});
}

/**
 * Shows manual installation instructions
 */
export function showManualInstallInstructions(): void {
	const command = manualInstallCommand();
	const message = `Scrape-LE requires Chromium to be installed.

To install manually, run this command in your terminal:
${command}

This is a one-time setup (~130MB download).`;

	const copyLabel = vscode.l10n.t('Copy Command');
	const learnMoreLabel = vscode.l10n.t('Learn More');

	vscode.window
		.showInformationMessage(message, copyLabel, learnMoreLabel)
		.then(async (choice) => {
			try {
				if (choice === copyLabel) {
					await vscode.env.clipboard.writeText(command);
					vscode.window.showInformationMessage(
						vscode.l10n.t('Command copied to clipboard!'),
					);
				} else if (choice === learnMoreLabel) {
					await vscode.env.openExternal(
						vscode.Uri.parse(
							'https://playwright.dev/docs/browsers#install-browsers',
						),
					);
				}
			} catch (error: unknown) {
				const errorMsg =
					error instanceof Error ? error.message : 'Unknown error';
				vscode.window.showErrorMessage(`Failed to execute action: ${errorMsg}`);
			}
		});
}
