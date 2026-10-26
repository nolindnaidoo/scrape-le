import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import * as vscodeMock from '../__mocks__/vscode';
import {
	_createExtensionContext,
	_registeredCommands,
	_resetMockState,
} from '../__mocks__/vscode';
import { ANTI_BOT_SIGNATURES } from '../detectors/heuristics';
import { manualInstallCommand } from '../scraper/install';
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
			openSpy.mock.calls[0]?.[0] as
				| { content: string; language: string }
				| undefined
		)?.content;

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

	// FEAT-17: the page listed four of the five vendors the corpus detects,
	// and an unpinned install command that install.ts says can fetch a
	// Chromium build the shipped playwright-core will not find.
	it('names every vendor in the corpus and the pinned install command', async () => {
		const openSpy = vi.spyOn(vscodeMock.workspace, 'openTextDocument');
		const context =
			_createExtensionContext() as unknown as vscode.ExtensionContext;
		registerHelpCommand(context, {
			notifier: createNotifier(),
			statusBar: createStatusBar(context),
		});
		await _registeredCommands().get('scrape-le.help')?.();
		const content = (
			openSpy.mock.calls[0]?.[0] as { content: string } | undefined
		)?.content;

		for (const signature of ANTI_BOT_SIGNATURES) {
			expect(content).toContain(signature.label);
		}
		expect(content).toContain(manualInstallCommand());
		expect(content).toMatch(
			/npx playwright-core@\d+\.\d+\.\d+ install chromium/,
		);
		expect(content).not.toContain('`npx playwright-core install chromium`');
	});
});
