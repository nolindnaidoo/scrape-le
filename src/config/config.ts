/**
 * Configuration management for Scrape-LE
 */
import * as vscode from 'vscode';
import type { Config, NotificationLevel } from '../types';

const EXTENSION_ID = 'scrape-le';

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: Config = Object.freeze({
	browser: Object.freeze({
		timeout: 30000,
		viewport: Object.freeze({
			width: 1280,
			height: 720,
		}),
		userAgent: undefined,
	}),
	screenshot: Object.freeze({
		enabled: true,
		path: '.vscode/scrape-le',
		format: 'png' as const,
		quality: 90,
	}),
	checkConsoleErrors: true,
	notificationsLevel: 'important' as NotificationLevel,
	statusBar: Object.freeze({
		enabled: true,
	}),
	detections: Object.freeze({
		antiBot: true,
		rateLimit: true,
		robotsTxt: true,
		authentication: true,
	}),
});

/**
 * Reads the current configuration from VS Code settings
 * Returns a frozen configuration object
 */
export function getConfiguration(): Config {
	const config = vscode.workspace.getConfiguration(EXTENSION_ID);

	const viewportWidth = config.get<number>('browser.viewport.width');
	const viewportHeight = config.get<number>('browser.viewport.height');
	const userAgent = config.get<string>('browser.userAgent');

	return Object.freeze({
		browser: Object.freeze({
			timeout:
				config.get<number>('browser.timeout') ?? DEFAULT_CONFIG.browser.timeout,
			viewport: Object.freeze({
				width: viewportWidth ?? DEFAULT_CONFIG.browser.viewport.width,
				height: viewportHeight ?? DEFAULT_CONFIG.browser.viewport.height,
			}),
			userAgent: userAgent && userAgent.trim() !== '' ? userAgent : undefined,
		}),
		screenshot: Object.freeze({
			enabled:
				config.get<boolean>('screenshot.enabled') ??
				DEFAULT_CONFIG.screenshot.enabled,
			path:
				config.get<string>('screenshot.path') ?? DEFAULT_CONFIG.screenshot.path,
			format:
				config.get<'png' | 'jpeg'>('screenshot.format') ??
				DEFAULT_CONFIG.screenshot.format,
			quality:
				config.get<number>('screenshot.quality') ??
				DEFAULT_CONFIG.screenshot.quality,
		}),
		checkConsoleErrors:
			config.get<boolean>('checkConsoleErrors') ??
			DEFAULT_CONFIG.checkConsoleErrors,
		notificationsLevel:
			config.get<NotificationLevel>('notificationsLevel') ??
			DEFAULT_CONFIG.notificationsLevel,
		statusBar: Object.freeze({
			enabled:
				config.get<boolean>('statusBar.enabled') ??
				DEFAULT_CONFIG.statusBar.enabled,
		}),
		detections: Object.freeze({
			antiBot:
				config.get<boolean>('detections.antiBot') ??
				DEFAULT_CONFIG.detections.antiBot,
			rateLimit:
				config.get<boolean>('detections.rateLimit') ??
				DEFAULT_CONFIG.detections.rateLimit,
			robotsTxt:
				config.get<boolean>('detections.robotsTxt') ??
				DEFAULT_CONFIG.detections.robotsTxt,
			authentication:
				config.get<boolean>('detections.authentication') ??
				DEFAULT_CONFIG.detections.authentication,
		}),
	});
}
