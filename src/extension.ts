/**
 * Scrape-LE Extension Entry Point
 */
import type * as vscode from 'vscode';
import { registerCommands } from './commands';
import { getConfiguration } from './config/config';
import { registerOpenSettingsCommand } from './config/settings';
import { createNotifier } from './ui/notifier';
import { createStatusBar } from './ui/statusBar';

/**
 * Extension activation
 */
export function activate(context: vscode.ExtensionContext): void {
	// Get initial configuration
	const config = getConfiguration();

	// Create UI components
	const notifier = createNotifier(config.notificationsLevel);
	const statusBar = createStatusBar(context);

	// Show status bar if enabled
	if (config.statusBar.enabled) {
		statusBar.show('$(globe) Scrape-LE', 'Click to check URL scrapeability');
	}

	// Register all commands
	registerCommands(context, {
		notifier,
		statusBar,
	});

	// Register settings command
	registerOpenSettingsCommand(context);
}

/**
 * Extension deactivation
 */
export function deactivate(): void {
	// Extensions are automatically disposed via context.subscriptions
}
