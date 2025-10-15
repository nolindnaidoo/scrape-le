/**
 * Status bar management for Scrape-LE
 */
import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import type { StatusBar } from '../types';

const localize = nls.config({ messageFormat: nls.MessageFormat.file })();

/**
 * Creates a status bar item for the extension
 */
export function createStatusBar(context: vscode.ExtensionContext): StatusBar {
	const statusBarItem = vscode.window.createStatusBarItem(
		vscode.StatusBarAlignment.Right,
		100,
	);

	statusBarItem.command = 'scrape-le.checkUrl';
	statusBarItem.text = localize('runtime.statusbar.text', '$(globe) Scrape-LE');
	statusBarItem.tooltip = localize(
		'runtime.statusbar.tooltip',
		'Click to check URL scrapeability',
	);

	context.subscriptions.push(statusBarItem);

	return Object.freeze({
		show(message: string, tooltip?: string): void {
			statusBarItem.text = message;
			if (tooltip) {
				statusBarItem.tooltip = tooltip;
			}
			statusBarItem.show();
		},

		hide(): void {
			statusBarItem.hide();
		},

		dispose(): void {
			statusBarItem.dispose();
		},
	});
}
