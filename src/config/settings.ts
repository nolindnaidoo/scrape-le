/**
 * Settings command registration for Scrape-LE
 */
import * as vscode from 'vscode';
import { guarded } from '../commands/guard';
import { createNotifier } from '../ui/notifier';

/**
 * Registers the open settings command
 */
export function registerOpenSettingsCommand(
	context: vscode.ExtensionContext,
): void {
	const command = vscode.commands.registerCommand(
		'scrape-le.openSettings',
		guarded(createNotifier(), async () => {
			await vscode.commands.executeCommand(
				'workbench.action.openSettings',
				'scrape-le',
			);
		}),
	);

	context.subscriptions.push(command);
}
