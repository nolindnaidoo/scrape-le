import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	_clipboardText,
	_resetMockState,
	_respondToInformation,
	_respondToWarning,
	_shownMessages,
	openedExternal,
} from '../__mocks__/vscode';
import {
	ensureBrowserInstalled,
	showManualInstallInstructions,
} from './install';

const { mockAvailable, spawnMock } = vi.hoisted(() => ({
	mockAvailable: vi.fn(async () => true),
	spawnMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({
	spawn: (...args: unknown[]) => spawnMock(...args),
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
		// Missing first (so the prompt appears), present after the install — the
		// installer verifies with a second check before reporting success.
		mockAvailable.mockResolvedValue(false);
		_respondToWarning(() => 'Cancel');

		expect(await ensureBrowserInstalled()).toBe(false);
	});

	it('opens the Playwright docs on Learn More', async () => {
		// Missing first (so the prompt appears), present after the install — the
		// installer verifies with a second check before reporting success.
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
		_respondToInformation((items) =>
			items.find((i) => String(i).includes('Copy')),
		);
		showManualInstallInstructions();
		await vi.waitFor(() => {
			expect(_clipboardText()).toContain('install chromium');
		});
	});

	it('opens the docs when the user picks Learn More', async () => {
		_respondToInformation((items) =>
			items.find((i) => String(i).includes('Learn More')),
		);
		showManualInstallInstructions();
		await vi.waitFor(() => {
			expect(openedExternal.length).toBeGreaterThan(0);
		});
	});

	it('does nothing when the message is dismissed', async () => {
		_respondToInformation(() => undefined);
		showManualInstallInstructions();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(_clipboardText()).toBeFalsy();
	});
});

describe('ensureBrowserInstalled: the install itself', () => {
	// spawn is what would actually fetch ~130MB; it is stubbed so the accept
	// path can be exercised without touching the network.
	beforeEach(() => {
		_resetMockState();
		vi.clearAllMocks();
		spawnMock.mockReset();
		// Missing first (so the prompt appears), present after the install — the
		// installer verifies with a second check before reporting success.
		mockAvailable.mockResolvedValue(false);
	});

	/** A fake child process that closes with the given exit code. */
	function fakeChild(code: number, stderr = '') {
		const child = new EventEmitter() as EventEmitter & { stderr: EventEmitter };
		child.stderr = new EventEmitter();
		queueMicrotask(() => {
			if (stderr) child.stderr.emit('data', Buffer.from(stderr));
			child.emit('close', code);
		});
		return child;
	}

	function acceptInstall(): void {
		_respondToWarning((items) =>
			items.find((i) => String(i).includes('Install')),
		);
	}

	it('runs the installer once and reports success', async () => {
		acceptInstall();
		mockAvailable.mockResolvedValueOnce(false).mockResolvedValue(true);
		spawnMock.mockImplementation(() => fakeChild(0));
		expect(await ensureBrowserInstalled()).toBe(true);
		expect(spawnMock).toHaveBeenCalledTimes(1);
	});

	it('reports a failure when the install completes but the browser is still missing', async () => {
		// The verification check is what catches a "successful" install that did
		// not actually produce a usable browser.
		acceptInstall();
		spawnMock.mockImplementation(() => fakeChild(0));
		expect(await ensureBrowserInstalled()).toBe(false);
	});

	it('reports a failure when the installer exits non-zero', async () => {
		acceptInstall();
		spawnMock.mockImplementation(() => fakeChild(1, 'download failed'));
		expect(await ensureBrowserInstalled()).toBe(false);
	});

	it('reports a failure when the process cannot start', async () => {
		acceptInstall();
		spawnMock.mockImplementation(() => {
			const child = new EventEmitter() as EventEmitter & {
				stderr: EventEmitter;
			};
			child.stderr = new EventEmitter();
			queueMicrotask(() => child.emit('error', new Error('ENOENT')));
			return child;
		});
		expect(await ensureBrowserInstalled()).toBe(false);
	});

	it('does not install when the prompt is dismissed', async () => {
		_respondToWarning(() => undefined);
		expect(await ensureBrowserInstalled()).toBe(false);
		expect(spawnMock).not.toHaveBeenCalled();
	});
});
