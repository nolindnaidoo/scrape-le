import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	_clipboardText,
	_resetMockState,
	_respondToWarning,
	_shownMessages,
	openedExternal,
} from '../__mocks__/vscode';
import {
	ensureBrowserInstalled,
	showManualInstallInstructions,
} from './install';

const { mockAvailable } = vi.hoisted(() => ({
	mockAvailable: vi.fn(async () => true),
}));

vi.mock('./browser', () => ({
	createBrowser: vi.fn(),
	closeBrowser: vi.fn(),
	isBrowserAvailable: mockAvailable,
}));

describe('ensureBrowserInstalled', () => {
	beforeEach(() => {
		_resetMockState();
		vi.clearAllMocks();
	});

	it('returns true immediately when the browser is available', async () => {
		mockAvailable.mockResolvedValue(true);

		expect(await ensureBrowserInstalled()).toBe(true);
		expect(_shownMessages()).toHaveLength(0);
	});

	it('returns false when the user cancels the prompt', async () => {
		mockAvailable.mockResolvedValue(false);
		_respondToWarning(() => 'Cancel');

		expect(await ensureBrowserInstalled()).toBe(false);
	});

	it('opens the Playwright docs on Learn More', async () => {
		mockAvailable.mockResolvedValue(false);
		_respondToWarning(() => 'Learn More');

		expect(await ensureBrowserInstalled()).toBe(false);
		expect(openedExternal[0]).toContain('playwright.dev');
	});
});

describe('showManualInstallInstructions', () => {
	beforeEach(() => {
		_resetMockState();
	});

	it('pins the manual command to the shipped playwright-core version', async () => {
		const { version } = await import('playwright-core/package.json');
		_respondToWarning(undefined);

		showManualInstallInstructions();
		await vi.waitFor(() => {
			expect(_shownMessages().length).toBeGreaterThan(0);
		});

		expect(_shownMessages()[0]?.message).toContain(
			`npx playwright-core@${version} install chromium`,
		);
	});

	it('copies the command when the user picks Copy Command', async () => {
		// showInformationMessage resolves undefined in the mock unless a
		// responder is wired; patch it through the warning responder path
		const vscodeMock = await import('../__mocks__/vscode');
		const original = vscodeMock.window.showInformationMessage;
		vscodeMock.window.showInformationMessage = async (
			_message: string,
			..._items: unknown[]
		) => {
			vscodeMock.window.showInformationMessage = original;
			return 'Copy Command' as unknown as undefined;
		};

		showManualInstallInstructions();
		await vi.waitFor(() => {
			expect(_clipboardText()).toContain('install chromium');
		});
	});
});
