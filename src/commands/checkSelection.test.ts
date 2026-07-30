import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import {
	_createDocument,
	_createExtensionContext,
	_registeredCommands,
	_resetMockState,
	_setActiveEditor,
	_setConfig,
	_shownMessages,
} from '../__mocks__/vscode';
import type { CheckResult } from '../types';
import { createNotifier } from '../ui/notifier';
import { createStatusBar } from '../ui/statusBar';
import { registerCheckSelectionCommand } from './checkSelection';

const { mockEnsure, mockCheck } = vi.hoisted(() => ({
	mockEnsure: vi.fn(async () => true),
	mockCheck: vi.fn(),
}));

vi.mock('../scraper/install', () => ({
	ensureBrowserInstalled: mockEnsure,
	showManualInstallInstructions: vi.fn(),
}));
vi.mock('../scraper/browser', () => ({
	createBrowser: vi.fn(async () => ({ browser: true })),
	closeBrowser: vi.fn(async () => {}),
	isBrowserAvailable: vi.fn(async () => true),
}));
vi.mock('../scraper/checker', () => ({
	checkPageScrapeability: mockCheck,
}));

async function runCheckSelection(): Promise<void> {
	const context =
		_createExtensionContext() as unknown as vscode.ExtensionContext;
	registerCheckSelectionCommand(context, {
		notifier: createNotifier(),
		statusBar: createStatusBar(context),
	});
	await _registeredCommands().get('scrape-le.checkSelection')?.();
}

describe('checkSelection command', () => {
	beforeEach(() => {
		_resetMockState();
		vi.clearAllMocks();
		vi.useFakeTimers();
		mockEnsure.mockResolvedValue(true);
		mockCheck.mockResolvedValue({
			success: true,
			url: 'https://example.com',
			statusCode: 200,
			title: 'Example',
			loadTimeMs: 42,
			consoleErrors: [],
		} as CheckResult);
		_setConfig('scrape-le.notificationsLevel', 'all');
	});

	it('warns when there is no active editor', async () => {
		_setActiveEditor(undefined);

		await runCheckSelection();

		expect(_shownMessages()[0]?.message).toBe('No active editor');
		expect(mockCheck).not.toHaveBeenCalled();
	});

	it('warns when the selection is empty', async () => {
		_setActiveEditor(_createDocument({ content: '   ' }));

		await runCheckSelection();

		expect(_shownMessages()[0]?.message).toBe('No text selected');
		expect(mockCheck).not.toHaveBeenCalled();
	});

	it('warns when no URL is found in the selection', async () => {
		_setActiveEditor(_createDocument({ content: 'no urls in here !!!' }));

		await runCheckSelection();

		expect(_shownMessages()[0]?.message).toBe(
			'No valid URL found in selection',
		);
		expect(mockCheck).not.toHaveBeenCalled();
	});

	it('extracts the first URL from the selection and checks it', async () => {
		_setActiveEditor(
			_createDocument({
				content: 'see https://first.example.com and https://second.example.com',
			}),
		);

		await runCheckSelection();

		expect(mockCheck).toHaveBeenCalledWith(
			expect.anything(),
			'https://first.example.com',
			expect.anything(),
		);
	});
});
