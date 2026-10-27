import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	_createExtensionContext,
	_live,
	_resetMockState,
	_respondToInputBox,
	_respondToQuickPick,
	_setConfig,
} from './__mocks__/vscode';
import { activate } from './extension';
import type { CheckResult } from './types';
import { disposeOutput } from './ui/output';
import { createStatusBar } from './ui/statusBar';

/**
 * What the extension holds, and whether it lets go.
 *
 * An extension host stays up for days, so a resource created per command and
 * never released is a real leak, and a deactivation that leaves a listener,
 * a channel or a timer behind is one too. The mock counts what is alive:
 * created and not disposed, registered and not removed.
 */

const { mockCheck } = vi.hoisted(() => ({ mockCheck: vi.fn() }));

vi.mock('./scraper/install', () => ({
	ensureBrowserInstalled: vi.fn(async () => true),
	showManualInstallInstructions: vi.fn(),
	manualInstallCommand: () => 'npx playwright-core@0.0.0 install chromium',
}));
vi.mock('./scraper/browser', () => ({
	createBrowser: vi.fn(async () => ({ browser: true })),
	closeBrowser: vi.fn(async () => {}),
	isBrowserAvailable: vi.fn(async () => true),
}));
vi.mock('./scraper/checker', () => ({
	checkPageScrapeability: mockCheck,
}));

const EVERY_COMMAND = [
	'scrape-le.checkUrl',
	'scrape-le.checkSelection',
	'scrape-le.setup',
	'scrape-le.openSettings',
	'scrape-le.help',
] as const;

async function runEveryCommand(): Promise<void> {
	const { _registeredCommands } = await import('./__mocks__/vscode');
	for (const id of EVERY_COMMAND) {
		const handler = _registeredCommands().get(id);
		if (!handler) throw new Error(`command not registered: ${id}`);
		await handler();
	}
}

beforeEach(() => {
	_resetMockState();
	disposeOutput();
	vi.clearAllMocks();
	_setConfig('scrape-le.notificationsLevel', 'all');
	// checkUrl runs a whole check against the mocked scraper; checkSelection
	// finds no editor and warns; setup is dismissed.
	_respondToInputBox(() => 'https://example.com');
	_respondToQuickPick(() => undefined);
	mockCheck.mockResolvedValue({
		success: true,
		url: 'https://example.com',
		statusCode: 200,
		title: 'Example',
		loadTimeMs: 42,
		consoleErrors: [],
	} as CheckResult);
});

describe('dispose is complete and safe to repeat', () => {
	it('status bar: the item and its pending reset, twice', () => {
		vi.useFakeTimers();
		try {
			const statusBar = createStatusBar(_createExtensionContext() as never);
			statusBar.show('busy');
			statusBar.resetAfter(5000);
			statusBar.dispose();
			expect(_live().statusBarItems).toBe(0);
			expect(vi.getTimerCount()).toBe(0);
			expect(() => statusBar.dispose()).not.toThrow();
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('deactivation leaves nothing behind', () => {
	it('after every command has run once', async () => {
		vi.useFakeTimers();
		try {
			const context = _createExtensionContext();
			activate(context as never);
			await runEveryCommand();
			expect(_live()).toEqual({
				statusBarItems: 1,
				outputChannels: 1,
				configListeners: 1,
				commands: 5,
				mcpProviders: 1,
			});
			// The check's five-second idle reset is pending here.
			expect(vi.getTimerCount()).toBe(1);

			for (const disposable of context.subscriptions) disposable.dispose();
			expect(_live()).toEqual({
				statusBarItems: 0,
				outputChannels: 0,
				configListeners: 0,
				commands: 0,
				mcpProviders: 0,
			});
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('repeated runs do not grow', () => {
	it('fifty rounds of every command', async () => {
		vi.useFakeTimers();
		try {
			const context = _createExtensionContext();
			activate(context as never);
			await runEveryCommand();
			const afterOne = _live();
			const subscriptions = context.subscriptions.length;
			for (let round = 0; round < 49; round++) await runEveryCommand();
			expect(_live()).toEqual(afterOne);
			expect(context.subscriptions.length).toBe(subscriptions);
			// One pending reset at most, however many checks ran.
			expect(vi.getTimerCount()).toBe(1);
		} finally {
			vi.useRealTimers();
		}
	});
});
