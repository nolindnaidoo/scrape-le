/**
 * Status bar management for Scrape-LE
 */
import * as vscode from 'vscode';
import { getConfiguration } from '../config/config';
import type { StatusBar } from '../types';

const IDLE_TEXT = '$(globe) Scrape-LE';
const IDLE_TOOLTIP = 'Click to check URL scrapeability';

/**
 * Creates the status bar item. Visibility is owned here and follows
 * scrape-le.statusBar.enabled live — show() only surfaces the item when
 * the setting allows it, and toggling the setting takes effect without
 * a reload.
 */
export function createStatusBar(context: vscode.ExtensionContext): StatusBar {
	const statusBarItem = vscode.window.createStatusBarItem(
		vscode.StatusBarAlignment.Right,
		100,
	);

	statusBarItem.command = 'scrape-le.checkUrl';
	statusBarItem.text = IDLE_TEXT;
	statusBarItem.tooltip = IDLE_TOOLTIP;

	const applyVisibility = (): void => {
		if (getConfiguration().statusBar.enabled) {
			statusBarItem.show();
		} else {
			statusBarItem.hide();
		}
	};
	applyVisibility();

	context.subscriptions.push(statusBarItem);
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration('scrape-le.statusBar.enabled')) {
				applyVisibility();
			}
		}),
	);

	return Object.freeze({
		show(message: string, tooltip?: string): void {
			statusBarItem.text = message;
			if (tooltip) {
				statusBarItem.tooltip = tooltip;
			}
			applyVisibility();
		},

		hide(): void {
			statusBarItem.hide();
		},

		dispose(): void {
			statusBarItem.dispose();
		},
	});
}
