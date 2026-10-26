/**
 * Setup command for browser installation
 */
import * as vscode from 'vscode';
import {
	ensureBrowserInstalled,
	showManualInstallInstructions,
} from '../scraper/install';
import type { Notifier } from '../types';
import { guarded } from './guard';

/**
 * Registers the setup command for browser installation.
 *
 * Results go through the notifier like every other command's, so
 * `notificationsLevel` governs them; the quick pick is interaction and
 * stays direct. The install flow inside `scraper/install.ts` is the
 * documented exception.
 */
export function registerSetupCommand(
	context: vscode.ExtensionContext,
	deps: Readonly<{ notifier: Notifier }>,
): void {
	const command = vscode.commands.registerCommand(
		'scrape-le.setup',
		guarded(deps.notifier, async () => {
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
					deps.notifier.info(
						vscode.l10n.t(
							'✅ Chromium is ready! You can now use Scrape-LE to check URLs.',
						),
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
					deps.notifier.info(
						vscode.l10n.t('✅ Chromium is installed and ready to use!'),
					);
					return;
				}
				deps.notifier.warn(
					vscode.l10n.t(
						'⚠️ Chromium is not installed. Please run the setup to install it.',
					),
				);
			}
		}),
	);

	context.subscriptions.push(command);
}
