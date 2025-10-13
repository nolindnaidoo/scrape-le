/**
 * Check selected URL command implementation
 */
import * as vscode from 'vscode';
import type { Notifier, StatusBar } from '../types';
import { extractUrlFromText } from '../utils/url';
import { executeCheck } from './check';

/**
 * Registers the check selection command
 */
export function registerCheckSelectionCommand(
	context: vscode.ExtensionContext,
	deps: Readonly<{
		notifier: Notifier;
		statusBar: StatusBar;
	}>,
): void {
	const command = vscode.commands.registerCommand(
		'scrape-le.checkSelection',
		async () => {
			const editor = vscode.window.activeTextEditor;

			if (!editor) {
				deps.notifier.warn('No active editor');
				return;
			}

			// Get selected text
			const selection = editor.selection;
			const selectedText = editor.document.getText(selection);

			if (!selectedText || selectedText.trim() === '') {
				deps.notifier.warn('No text selected');
				return;
			}

			// Extract URL from selection
			const url = extractUrlFromText(selectedText);

			if (!url) {
				deps.notifier.warn('No valid URL found in selection');
				return;
			}

			// Execute the check using the same logic as checkUrl
			await executeCheck(url, deps, context);
		},
	);

	context.subscriptions.push(command);
}
