import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import {
	_createExtensionContext,
	_registeredCommands,
	_resetMockState,
	executedBuiltins,
} from './__mocks__/vscode';
import { activate, deactivate } from './extension';

vi.mock('./scraper/browser', () => ({
	createBrowser: vi.fn(),
	closeBrowser: vi.fn(),
	isBrowserAvailable: vi.fn(async () => false),
}));

describe('extension activation', () => {
	beforeEach(() => {
		_resetMockState();
	});

	it('registers every command declared in the manifest', () => {
		activate(_createExtensionContext() as unknown as vscode.ExtensionContext);

		const registered = [..._registeredCommands().keys()].sort();
		expect(registered).toEqual([
			'scrape-le.checkSelection',
			'scrape-le.checkUrl',
			'scrape-le.help',
			'scrape-le.openSettings',
			'scrape-le.setup',
		]);
	});

	it('openSettings opens the scrape-le settings UI', async () => {
		activate(_createExtensionContext() as unknown as vscode.ExtensionContext);

		const handler = _registeredCommands().get('scrape-le.openSettings');
		await handler?.();

		expect(executedBuiltins).toEqual([
			{ id: 'workbench.action.openSettings', args: ['scrape-le'] },
		]);
	});

	it('deactivate is a no-op', () => {
		expect(deactivate()).toBeUndefined();
	});
});
