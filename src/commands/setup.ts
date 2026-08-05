/**
 * Setup command for browser installation
 */
import * as vscode from 'vscode';
import {
	ensureBrowserInstalled,
	showManualInstallInstructions,
} from '../scraper/install';

/**
 * Registers the setup command for browser installation
 */
export function registerSetupCommand(context: vscode.ExtensionContext): void {
	const command = vscode.commands.registerCommand(
		'scrape-le.setup',
		async () => {
			const choice = await vscode.window.showQuickPick(
				[
					{
						label: '$(cloud-download) Install Chromium Browser',
						description: vscode.l10n.t(
							'Automatic installation (~130MB download)',
						),
						action: 'install',
					},
					{
						label: '$(info) Manual Installation Instructions',
						description: vscode.l10n.t('Show command to run manually'),
						action: 'manual',
					},
					{
						label: '$(check) Test Browser Installation',
						description: vscode.l10n.t(
							'Check if Chromium is already installed',
						),
						action: 'test',
					},
				],
				{
					placeHolder: vscode.l10n.t('Choose a setup option'),
					title: vscode.l10n.t('Scrape-LE Browser Setup'),
				},
			);

			if (!choice) {
				return;
			}

			if (choice.action === 'install') {
				const installed = await ensureBrowserInstalled();
				if (installed) {
					vscode.window.showInformationMessage(
						'✅ Chromium is ready! You can now use Scrape-LE to check URLs.',
					);
				}
			}
			if (choice.action === 'manual') {
				showManualInstallInstructions();
			}
			if (choice.action === 'test') {
				// Test by trying to import and check
				const { isBrowserAvailable } = await import('../scraper/browser');
				const available = await isBrowserAvailable();

				if (available) {
					vscode.window.showInformationMessage(
						'✅ Chromium is installed and ready to use!',
					);
					return;
				}
				vscode.window.showWarningMessage(
					'⚠️ Chromium is not installed. Please run the setup to install it.',
				);
			}
		},
	);

	context.subscriptions.push(command);
}
