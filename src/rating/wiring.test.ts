import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	_createExtensionContext,
	_registeredCommands,
	_resetMockState,
	_respondToInputBox,
} from '../__mocks__/vscode';
import { activate } from '../extension';
import type { CheckResult } from '../types';
import { RATING_STATE_KEY } from '../ui/ratingPrompt';
import { parseRatingState } from './policy';

/**
 * The prompt's own tests cover when it asks. This covers the one thing they
 * cannot: that the real command, registered by the real activate(), counts a
 * page it reached and nothing else.
 */

const { mockCheck } = vi.hoisted(() => ({ mockCheck: vi.fn() }));

vi.mock('../scraper/install', () => ({
	ensureBrowserInstalled: vi.fn(async () => true),
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

function checkResult(success: boolean): CheckResult {
	return {
		success,
		url: 'https://example.com',
		statusCode: success ? 200 : 0,
		title: 'Example',
		loadTimeMs: 42,
		consoleErrors: [],
		...(success ? {} : { error: 'net::ERR_NAME_NOT_RESOLVED' }),
	} as CheckResult;
}

function activated() {
	const context = _createExtensionContext();
	activate(context as never);
	const uses = (): number =>
		parseRatingState(context.globalState.get(RATING_STATE_KEY)).uses;
	return { uses };
}

async function run(): Promise<void> {
	const handler = _registeredCommands().get('scrape-le.checkUrl');
	if (!handler) throw new Error('command not registered: scrape-le.checkUrl');
	await handler();
}

beforeEach(() => {
	_resetMockState();
	// The command resets the status bar on a five-second timer; faked so it
	// cannot fire into a later test.
	vi.useFakeTimers();
	_respondToInputBox(() => 'https://example.com');
});

describe('rating prompt wiring', () => {
	it('counts a check that reached the page', async () => {
		mockCheck.mockResolvedValue(checkResult(true));
		const { uses } = activated();
		await run();
		// recordSuccess is not awaited by the command.
		await vi.advanceTimersByTimeAsync(20);
		expect(uses()).toBe(1);
	});

	it('does not count a check that could not reach the page', async () => {
		mockCheck.mockResolvedValue(checkResult(false));
		const { uses } = activated();
		await run();
		await vi.advanceTimersByTimeAsync(20);
		expect(uses()).toBe(0);
	});
});
