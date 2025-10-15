/**
 * Setup command for browser installation
 */
import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import {
	ensureBrowserInstalled,
	showManualInstallInstructions,
} from '../scraper/install';

const localize = nls.config({ messageFormat: nls.MessageFormat.file })();

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
						label: localize(
							'runtime.setup.install.label',
							'$(cloud-download) Install Chromium Browser',
						),
						description: localize(
							'runtime.setup.install.description',
							'Automatic installation (~130MB download)',
						),
						action: 'install',
					},
					{
						label: localize(
							'runtime.setup.manual.label',
							'$(info) Manual Installation Instructions',
						),
						description: localize(
							'runtime.setup.manual.description',
							'Show command to run manually',
						),
						action: 'manual',
					},
					{
						label: localize(
							'runtime.setup.test.label',
							'$(check) Test Browser Installation',
						),
						description: localize(
							'runtime.setup.test.description',
							'Check if Chromium is already installed',
						),
						action: 'test',
					},
				],
				{
					placeHolder: localize(
						'runtime.setup.placeholder',
						'Choose a setup option',
					),
					title: localize('runtime.setup.title', 'Scrape-LE Browser Setup'),
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
			} else if (choice.action === 'manual') {
				showManualInstallInstructions();
			} else if (choice.action === 'test') {
				// Test by trying to import and check
				const { isBrowserAvailable } = await import('../scraper/browser');
				const available = await isBrowserAvailable();

				if (available) {
					vscode.window.showInformationMessage(
						'✅ Chromium is installed and ready to use!',
					);
				} else {
					vscode.window.showWarningMessage(
						'⚠️ Chromium is not installed. Please run the setup to install it.',
					);
				}
			}
		},
	);

	context.subscriptions.push(command);
}
