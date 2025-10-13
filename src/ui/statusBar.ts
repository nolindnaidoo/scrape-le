/**
 * Status bar management for Scrape-LE
 */
import * as vscode from 'vscode';
import type { StatusBar } from '../types';

/**
 * Creates a status bar item for the extension
 */
export function createStatusBar(context: vscode.ExtensionContext): StatusBar {
	const statusBarItem = vscode.window.createStatusBarItem(
		vscode.StatusBarAlignment.Right,
		100,
	);

	statusBarItem.command = 'scrape-le.checkUrl';
	statusBarItem.text = '$(globe) Scrape-LE';
	statusBarItem.tooltip = 'Click to check URL scrapeability';

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
