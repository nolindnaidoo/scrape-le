import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import {
	_createExtensionContext,
	_registeredCommands,
	_resetMockState,
	_respondToQuickPick,
	_shownMessages,
} from '../__mocks__/vscode';
import { registerSetupCommand } from './setup';

const { mockEnsure, mockAvailable } = vi.hoisted(() => ({
	mockEnsure: vi.fn(async () => true),
	mockAvailable: vi.fn(async () => true),
}));

vi.mock('../scraper/install', async (importOriginal) => {
	const original = await importOriginal<object>();
	return {
		...original,
		ensureBrowserInstalled: mockEnsure,
	};
});
vi.mock('../scraper/browser', () => ({
	createBrowser: vi.fn(),
	closeBrowser: vi.fn(),
	isBrowserAvailable: mockAvailable,
}));

type QuickPickItem = { action: string };

async function runSetup(action: string | undefined): Promise<void> {
	_respondToQuickPick((items) =>
		action
			? (items as QuickPickItem[]).find((i) => i.action === action)
			: undefined,
	);
	const context =
		_createExtensionContext() as unknown as vscode.ExtensionContext;
	registerSetupCommand(context);
	await _registeredCommands().get('scrape-le.setup')?.();
}

describe('setup command', () => {
	beforeEach(() => {
		_resetMockState();
		vi.clearAllMocks();
	});

	it('does nothing when the quick pick is dismissed', async () => {
		await runSetup(undefined);
		expect(mockEnsure).not.toHaveBeenCalled();
		expect(_shownMessages()).toHaveLength(0);
	});

	it('install: reports success when the browser gets installed', async () => {
		mockEnsure.mockResolvedValue(true);

		await runSetup('install');

		expect(mockEnsure).toHaveBeenCalled();
		expect(
			_shownMessages().some((m) => m.message.includes('Chromium is ready')),
		).toBe(true);
	});

	it('manual: copies the pinned install command to the clipboard', async () => {
		const { _respondToWarning } = await import('../__mocks__/vscode');
		_respondToWarning(undefined);
		const respondInfo = (await import('../__mocks__/vscode'))._shownMessages;

		await runSetup('manual');

		// the instructions message offers Copy Command / Learn More
		expect(
			respondInfo().some((m) => m.message.includes('npx playwright-core@')),
		).toBe(true);
	});

	it('test: reports an installed browser', async () => {
		mockAvailable.mockResolvedValue(true);

		await runSetup('test');

		expect(
			_shownMessages().some((m) => m.message.includes('installed and ready')),
		).toBe(true);
	});

	it('test: warns when the browser is missing', async () => {
		mockAvailable.mockResolvedValue(false);

		await runSetup('test');

		expect(
			_shownMessages().some(
				(m) => m.kind === 'warning' && m.message.includes('not installed'),
			),
		).toBe(true);
	});
});
