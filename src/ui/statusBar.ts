/**
 * Status bar management for Scrape-LE
 */
import * as vscode from 'vscode';
import { getConfiguration } from '../config/config';
import type { StatusBar } from '../types';

/** A codicon and the product name: never translated. */
const IDLE_TEXT = '$(globe) Scrape-LE';
// Read inside the function, never at module scope: `l10n.t()` resolves
// when it runs, and the bundle is not loaded when the module is required.
const idleTooltip = (): string =>
	vscode.l10n.t('Click to check URL scrapeability');

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
	statusBarItem.tooltip = idleTooltip();

	const applyVisibility = (): void => {
		if (getConfiguration().statusBar.enabled) {
			statusBarItem.show();
			return;
		}
		statusBarItem.hide();
	};
	applyVisibility();

	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration('scrape-le.statusBar.enabled')) {
				applyVisibility();
			}
		}),
	);

	// One pending reset at most. The timer used to live in the check
	// command, untracked: a second check started inside the first's cooldown
	// had its own "Checking..." replaced by the idle text when the first's
	// timer fired, and the timer outlived deactivation.
	let pendingReset: ReturnType<typeof setTimeout> | undefined;
	const cancelReset = (): void => {
		if (pendingReset === undefined) return;
		clearTimeout(pendingReset);
		pendingReset = undefined;
	};

	const statusBar: StatusBar = Object.freeze({
		show(message: string, tooltip?: string): void {
			cancelReset();
			statusBarItem.text = message;
			if (tooltip) {
				statusBarItem.tooltip = tooltip;
			}
			applyVisibility();
		},

		resetAfter(delayMs: number): void {
			cancelReset();
			pendingReset = setTimeout(() => {
				pendingReset = undefined;
				statusBarItem.text = IDLE_TEXT;
				statusBarItem.tooltip = idleTooltip();
				applyVisibility();
			}, delayMs);
		},

		hide(): void {
			statusBarItem.hide();
		},

		dispose(): void {
			cancelReset();
			statusBarItem.dispose();
		},
	});
	// The wrapper, not the bare item: deactivation has to cancel a pending
	// reset as well as release the item, and only the wrapper knows the timer.
	context.subscriptions.push(statusBar);
	return statusBar;
}
