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
import { disposeOutput } from '../ui/output';
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

function registerCheckUrl(): () => Promise<void> {
	const context =
		_createExtensionContext() as unknown as vscode.ExtensionContext;
	registerCheckUrlCommand(context, {
		notifier: createNotifier(),
		statusBar: createStatusBar(context),
		ratingPrompt: { recordSuccess: async () => {} },
	});
	const handler = _registeredCommands().get('scrape-le.checkUrl');
	if (!handler) throw new Error('scrape-le.checkUrl was not registered');
	return async () => {
		await handler();
	};
}

async function runCheckUrl(): Promise<void> {
	await registerCheckUrl()();
}

/** A promise the test resolves by hand, to hold a check at a suspension. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
	let resolve: (value: T) => void = () => {};
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

/** Lets every settled continuation run without moving the fake clock. */
async function settle(): Promise<void> {
	for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
}

describe('checkUrl command', () => {
	beforeEach(() => {
		_resetMockState();
		// The output module keeps its channel across tests; released here so
		// each test reads the channel its own run created, in any order.
		disposeOutput();
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

	// RACE-3: two checks run independently; the status item shows the most
	// recent event, and the idle reset fires five seconds after the last
	// result. The first check's cooldown timer used to fire while the second
	// was still showing its result, and replaced it with the idle text.
	it('a check started during another one keeps its own result through the first cooldown', async () => {
		const first = deferred<CheckResult>();
		const second = deferred<CheckResult>();
		mockCheck
			.mockReturnValueOnce(first.promise)
			.mockReturnValueOnce(second.promise);
		_respondToInputBox(() => 'https://example.com');
		const check = registerCheckUrl();

		const run1 = check();
		await settle();
		const run2 = check();
		await settle();
		expect(_statusBarItems()[0]?.text).toContain('Checking');

		first.resolve(successResult({ loadTimeMs: 42 }));
		await run1;
		expect(_statusBarItems()[0]?.text).toContain('Reachable (42ms)');

		vi.advanceTimersByTime(3000);
		second.resolve(successResult({ loadTimeMs: 77 }));
		await run2;
		expect(_statusBarItems()[0]?.text).toContain('Reachable (77ms)');

		// Five seconds after the first result: its timer must not reset the
		// second's result.
		vi.advanceTimersByTime(2000);
		expect(_statusBarItems()[0]?.text).toContain('Reachable (77ms)');
		// Five seconds after the second result: idle.
		vi.advanceTimersByTime(3000);
		expect(_statusBarItems()[0]?.text).toBe('$(globe) Scrape-LE');
		expect(vi.getTimerCount()).toBe(0);
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
