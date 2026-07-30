import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import {
	_createExtensionContext,
	_outputChannels,
	_registeredCommands,
	_resetMockState,
	_respondToInputBox,
	_setConfig,
	_shownMessages,
	_statusBarItems,
} from '../__mocks__/vscode';
import type { CheckResult } from '../types';
import { createNotifier } from '../ui/notifier';
import { createStatusBar } from '../ui/statusBar';
import { registerCheckUrlCommand } from './check';

const { mockEnsure, mockCreateBrowser, mockCloseBrowser, mockCheck } =
	vi.hoisted(() => ({
		mockEnsure: vi.fn(async () => true),
		mockCreateBrowser: vi.fn(async () => ({ browser: true })),
		mockCloseBrowser: vi.fn(async () => {}),
		mockCheck: vi.fn(),
	}));

vi.mock('../scraper/install', () => ({
	ensureBrowserInstalled: mockEnsure,
	showManualInstallInstructions: vi.fn(),
}));
vi.mock('../scraper/browser', () => ({
	createBrowser: mockCreateBrowser,
	closeBrowser: mockCloseBrowser,
	isBrowserAvailable: vi.fn(async () => true),
}));
vi.mock('../scraper/checker', () => ({
	checkPageScrapeability: mockCheck,
}));

function successResult(overrides: Partial<CheckResult> = {}): CheckResult {
	return {
		success: true,
		url: 'https://example.com',
		statusCode: 200,
		title: 'Example',
		loadTimeMs: 42,
		consoleErrors: [],
		...overrides,
	} as CheckResult;
}

async function runCheckUrl(): Promise<void> {
	const context =
		_createExtensionContext() as unknown as vscode.ExtensionContext;
	registerCheckUrlCommand(context, {
		notifier: createNotifier(),
		statusBar: createStatusBar(context),
	});
	await _registeredCommands().get('scrape-le.checkUrl')?.();
}

describe('checkUrl command', () => {
	beforeEach(() => {
		_resetMockState();
		vi.clearAllMocks();
		vi.useFakeTimers();
		mockEnsure.mockResolvedValue(true);
		mockCheck.mockResolvedValue(successResult());
		_setConfig('scrape-le.notificationsLevel', 'all');
	});

	it('runs a full successful check', async () => {
		_respondToInputBox(() => 'https://example.com');

		await runCheckUrl();

		expect(mockCheck).toHaveBeenCalledWith(
			{ browser: true },
			'https://example.com',
			expect.objectContaining({ timeout: 30000, checkConsoleErrors: true }),
		);
		expect(mockCloseBrowser).toHaveBeenCalled();
		expect(_shownMessages().some((m) => m.message.includes('reachable'))).toBe(
			true,
		);
		expect(_statusBarItems()[0]?.text).toContain('Reachable (42ms)');
		expect(_outputChannels()[0]?._shown).toBe(true);

		// idle text restored after the 5s cooldown
		vi.advanceTimersByTime(5000);
		expect(_statusBarItems()[0]?.text).toBe('$(globe) Scrape-LE');
	});

	it('normalizes a protocol-less URL before checking', async () => {
		_respondToInputBox(() => 'example.com');

		await runCheckUrl();

		expect(mockCheck).toHaveBeenCalledWith(
			expect.anything(),
			'https://example.com',
			expect.anything(),
		);
	});

	it('does nothing when the user cancels the prompt', async () => {
		_respondToInputBox(() => undefined);

		await runCheckUrl();

		expect(mockCheck).not.toHaveBeenCalled();
	});

	it('warns and stops when the browser is unavailable', async () => {
		mockEnsure.mockResolvedValue(false);
		_respondToInputBox(() => 'https://example.com');

		await runCheckUrl();

		expect(mockCheck).not.toHaveBeenCalled();
		expect(
			_shownMessages().some(
				(m) => m.kind === 'warning' && m.message.includes('Chromium'),
			),
		).toBe(true);
	});

	it('reports console errors as a warning', async () => {
		mockCheck.mockResolvedValue(
			successResult({ consoleErrors: ['boom', 'bang'] }),
		);
		_respondToInputBox(() => 'https://example.com');

		await runCheckUrl();

		expect(
			_shownMessages().some(
				(m) => m.kind === 'warning' && m.message.includes('2 console error'),
			),
		).toBe(true);
	});

	it('surfaces a failed check via notifier and status bar', async () => {
		mockCheck.mockResolvedValue(
			successResult({ success: false, error: 'net::ERR_CONNECTION_REFUSED' }),
		);
		_respondToInputBox(() => 'https://example.com');

		await runCheckUrl();

		expect(
			_shownMessages().some(
				(m) => m.kind === 'error' && m.message.includes('Failed to reach'),
			),
		).toBe(true);
		expect(_statusBarItems()[0]?.text).toContain('Failed');
	});

	it('formats thrown errors and still closes the browser', async () => {
		mockCheck.mockRejectedValue(new Error('page timeout exceeded'));
		_respondToInputBox(() => 'https://example.com');

		await runCheckUrl();

		expect(mockCloseBrowser).toHaveBeenCalled();
		expect(
			_shownMessages().some(
				(m) => m.kind === 'error' && m.message.includes('Timeout'),
			),
		).toBe(true);
	});
});
