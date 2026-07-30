import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import * as vscodeMock from '../__mocks__/vscode';
import {
	_createExtensionContext,
	_registeredCommands,
	_resetMockState,
} from '../__mocks__/vscode';
import { createNotifier } from '../ui/notifier';
import { createStatusBar } from '../ui/statusBar';
import { registerHelpCommand } from './help';

describe('help command', () => {
	beforeEach(() => {
		_resetMockState();
	});

	it('opens a markdown document listing only real commands', async () => {
		const openSpy = vi.spyOn(vscodeMock.workspace, 'openTextDocument');
		const showSpy = vi.spyOn(vscodeMock.window, 'showTextDocument');

		const context =
			_createExtensionContext() as unknown as vscode.ExtensionContext;
		registerHelpCommand(context, {
			notifier: createNotifier(),
			statusBar: createStatusBar(context),
		});
		await _registeredCommands().get('scrape-le.help')?.();

		expect(openSpy).toHaveBeenCalledOnce();
		const content = (
			openSpy.mock.calls[0]?.[0] as { content: string; language: string }
		).content;

		expect(content).toContain('# Scrape-LE Help & Troubleshooting');
		// real features
		expect(content).toContain('Check URL Scrapeability');
		expect(content).toContain('Setup Browser');
		// v1.x phantom features must stay gone
		expect(content).not.toContain('Export Results');
		expect(content).not.toContain('Use Playwright');
		expect(content).not.toContain('Telemetry');
		// only real settings documented
		expect(content).toContain('browser.timeout');
		expect(content).toContain('detections.antiBot');

		expect(showSpy).toHaveBeenCalledOnce();
	});
});
