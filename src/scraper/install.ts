/**
 * Browser installation utilities for Scrape-LE
 */
import * as vscode from 'vscode';
import { isBrowserAvailable } from './browser';

let _installCheckPerformed = false;

/**
 * Checks if browser is installed and prompts user to install if not
 * Returns true if browser is available, false otherwise
 */
export async function ensureBrowserInstalled(): Promise<boolean> {
	// Check if browser is available
	const isAvailable = await isBrowserAvailable();

	if (isAvailable) {
		return true;
	}

	// Browser not available - prompt user
	const message =
		'Scrape-LE requires Chromium browser to be installed. Would you like to install it now? (This is a one-time setup, ~130MB download)';

	const choice = await vscode.window.showWarningMessage(
		message,
		'Install Chromium',
		'Cancel',
		'Learn More',
	);

	if (choice === 'Install Chromium') {
		return await installBrowser();
	}

	if (choice === 'Learn More') {
		await vscode.env.openExternal(
			vscode.Uri.parse('https://playwright.dev/docs/browsers#install-browsers'),
		);
		return false;
	}

	return false;
}

/**
 * Installs the Chromium browser via Playwright
 */
async function installBrowser(): Promise<boolean> {
	return await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: 'Installing Chromium',
			cancellable: false,
		},
		async (progress) => {
			try {
				progress.report({ message: 'Downloading Chromium browser...' });

				// Use Node.js to run the installation
				const { execSync } = await import('node:child_process');

				// Install chromium using npx playwright install
				execSync('npx playwright install chromium', {
					cwd: __dirname,
					stdio: 'pipe',
				});

				progress.report({ message: 'Installation complete!' });

				// Verify installation
				const isNowAvailable = await isBrowserAvailable();

				if (isNowAvailable) {
					vscode.window.showInformationMessage(
						'✅ Chromium installed successfully!',
					);
					return true;
				}

				vscode.window.showErrorMessage(
					'❌ Chromium installation completed but browser is not available. Please try running "npx playwright install chromium" manually.',
				);
				return false;
			} catch (error) {
				const errorMessage =
					error instanceof Error ? error.message : 'Unknown error';
				vscode.window.showErrorMessage(
					`❌ Failed to install Chromium: ${errorMessage}. Please run "npx playwright install chromium" manually.`,
				);
				return false;
			}
		},
	);
}

/**
 * Shows manual installation instructions
 */
export function showManualInstallInstructions(): void {
	const message = `Scrape-LE requires Chromium to be installed.

To install manually, run this command in your terminal:
npx playwright install chromium

This is a one-time setup (~130MB download).`;

	vscode.window
		.showInformationMessage(message, 'Copy Command', 'Learn More')
		.then(async (choice) => {
			try {
				if (choice === 'Copy Command') {
					await vscode.env.clipboard.writeText(
						'npx playwright install chromium',
					);
					vscode.window.showInformationMessage('Command copied to clipboard!');
				} else if (choice === 'Learn More') {
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

/**
 * Resets the install check flag (for testing)
 */
export function resetInstallCheck(): void {
	_installCheckPerformed = false;
}

export const BrowserInstaller = Object.freeze({
	ensureBrowserInstalled,
	showManualInstallInstructions,
	resetInstallCheck,
});
