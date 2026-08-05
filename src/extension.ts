/**
 * Scrape-LE Extension Entry Point
 */
import type * as vscode from 'vscode';
import { registerCommands } from './commands';
import { registerOpenSettingsCommand } from './config/settings';
import { registerMcpProvider } from './mcp/provider';
import { createNotifier } from './ui/notifier';
import { createStatusBar } from './ui/statusBar';

/**
 * Extension activation
 */
export function activate(context: vscode.ExtensionContext): void {
	const notifier = createNotifier();
	const statusBar = createStatusBar(context);

	registerCommands(context, {
		notifier,
		statusBar,
	});

	registerOpenSettingsCommand(context);

	// Offer the bundled MCP server to agent mode, where the host supports it
	registerMcpProvider(context);
}

/**
 * Extension deactivation
 */
export function deactivate(): void {
	// Extensions are automatically disposed via context.subscriptions
}
