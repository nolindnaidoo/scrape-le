/**
 * Notification management for Scrape-LE
 */
import * as vscode from 'vscode';
import { getConfiguration } from '../config/config';
import type { Notifier } from '../types';

/**
 * All user notifications route through here so notificationsLevel
 * actually governs them, re-read on every call: 'all' shows everything,
 * 'important' shows warnings and errors, 'silent' shows errors only.
 */
export function createNotifier(): Notifier {
	return Object.freeze({
		info(message: string): void {
			if (getConfiguration().notificationsLevel === 'all') {
				vscode.window.showInformationMessage(message);
			}
		},

		warn(message: string): void {
			if (getConfiguration().notificationsLevel !== 'silent') {
				vscode.window.showWarningMessage(message);
			}
		},

		error(message: string): void {
			vscode.window.showErrorMessage(message);
		},
	});
}
