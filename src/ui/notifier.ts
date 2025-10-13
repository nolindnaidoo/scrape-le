/**
 * Notification management for Scrape-LE
 */
import * as vscode from 'vscode';
import type { NotificationLevel, Notifier } from '../types';

/**
 * Creates a notifier with configurable verbosity
 */
export function createNotifier(
	level: NotificationLevel = 'important',
): Notifier {
	const shouldShowAll = level === 'all';
	const shouldShowImportant = level === 'important' || level === 'all';
	const isSilent = level === 'silent';

	return Object.freeze({
		info(message: string): void {
			if (shouldShowAll && !isSilent) {
				vscode.window.showInformationMessage(message);
			}
		},

		warn(message: string): void {
			if (shouldShowImportant && !isSilent) {
				vscode.window.showWarningMessage(message);
			}
		},

		error(message: string): void {
			if (!isSilent) {
				vscode.window.showErrorMessage(message);
			}
		},
	});
}
