/**
 * Command registration index for Scrape-LE
 */
import type * as vscode from 'vscode';
import type { Notifier, StatusBar } from '../types';
import { registerCheckUrlCommand } from './check';
import { registerCheckSelectionCommand } from './checkSelection';
import { registerHelpCommand } from './help';
import { registerSetupCommand } from './setup';

/**
 * Registers all extension commands
 */
export function registerCommands(
	context: vscode.ExtensionContext,
	deps: Readonly<{
		notifier: Notifier;
		statusBar: StatusBar;
	}>,
): void {
	registerCheckUrlCommand(context, deps);
	registerCheckSelectionCommand(context, deps);
	registerSetupCommand(context);
	registerHelpCommand(context, deps);
}
