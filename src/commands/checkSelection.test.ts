import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';

// Mock vscode
vi.mock('vscode', async () => {
	return {
		window: {
			activeTextEditor: undefined,
			showInformationMessage: vi.fn(),
			showWarningMessage: vi.fn(),
			withProgress: vi.fn(),
		},
		workspace: {
			workspaceFolders: [],
		},
		commands: {
			registerCommand: vi.fn((_, callback) => ({ dispose: vi.fn() })),
		},
		ProgressLocation: {
			Notification: 15,
		},
	};
});

// Mock dependencies
vi.mock('../utils/url', () => ({
	extractUrlFromText: vi.fn(),
}));

vi.mock('./check', () => ({
	executeCheck: vi.fn(),
}));

describe('checkSelection', () => {
	let mockVscode: typeof vscode;
	let urlUtils: { extractUrlFromText: ReturnType<typeof vi.fn> };
	let checkModule: { executeCheck: ReturnType<typeof vi.fn> };

	beforeEach(async () => {
		vi.clearAllMocks();
		mockVscode = await import('vscode');
		urlUtils = await import('../utils/url');
		checkModule = await import('./check');
	});

	describe('registerCheckSelectionCommand', () => {
		it('should register the command', async () => {
			const mockContext = {
				subscriptions: [],
			} as unknown as vscode.ExtensionContext;

			const mockDeps = {
				notifier: {
					info: vi.fn(),
					warn: vi.fn(),
					error: vi.fn(),
				},
				statusBar: {
					show: vi.fn(),
					hide: vi.fn(),
					dispose: vi.fn(),
				},
			};

			const { registerCheckSelectionCommand } = await import(
				'./checkSelection'
			);
			registerCheckSelectionCommand(mockContext, mockDeps);

			expect(mockVscode.commands.registerCommand).toHaveBeenCalledWith(
				'scrape-le.checkSelection',
				expect.any(Function),
			);
		});

		it('should warn when no active editor', async () => {
			const mockContext = {
				subscriptions: [],
			} as unknown as vscode.ExtensionContext;

			const mockDeps = {
				notifier: {
					info: vi.fn(),
					warn: vi.fn(),
					error: vi.fn(),
				},
				statusBar: {
					show: vi.fn(),
					hide: vi.fn(),
					dispose: vi.fn(),
				},
			};

			mockVscode.window.activeTextEditor = undefined;

			const { registerCheckSelectionCommand } = await import(
				'./checkSelection'
			);
			registerCheckSelectionCommand(mockContext, mockDeps);

			// Get the command callback
			const commandCallback = vi.mocked(mockVscode.commands.registerCommand)
				.mock.calls[0][1] as () => Promise<void>;

			await commandCallback();

			expect(mockDeps.notifier.warn).toHaveBeenCalledWith('No active editor');
		});

		it('should warn when no text is selected', async () => {
			const mockContext = {
				subscriptions: [],
			} as unknown as vscode.ExtensionContext;

			const mockDeps = {
				notifier: {
					info: vi.fn(),
					warn: vi.fn(),
					error: vi.fn(),
				},
				statusBar: {
					show: vi.fn(),
					hide: vi.fn(),
					dispose: vi.fn(),
				},
			};

			mockVscode.window.activeTextEditor = {
				selection: { start: 0, end: 0 },
				document: {
					getText: vi.fn().mockReturnValue(''),
				},
			} as never;

			const { registerCheckSelectionCommand } = await import(
				'./checkSelection'
			);
			registerCheckSelectionCommand(mockContext, mockDeps);

			const commandCallback = vi.mocked(mockVscode.commands.registerCommand)
				.mock.calls[0][1] as () => Promise<void>;

			await commandCallback();

			expect(mockDeps.notifier.warn).toHaveBeenCalledWith('No text selected');
		});

		it('should warn when no valid URL found in selection', async () => {
			const mockContext = {
				subscriptions: [],
			} as unknown as vscode.ExtensionContext;

			const mockDeps = {
				notifier: {
					info: vi.fn(),
					warn: vi.fn(),
					error: vi.fn(),
				},
				statusBar: {
					show: vi.fn(),
					hide: vi.fn(),
					dispose: vi.fn(),
				},
			};

			mockVscode.window.activeTextEditor = {
				selection: { start: 0, end: 10 },
				document: {
					getText: vi.fn().mockReturnValue('no url here'),
				},
			} as never;

			vi.mocked(urlUtils.extractUrlFromText).mockReturnValue(null);

			const { registerCheckSelectionCommand } = await import(
				'./checkSelection'
			);
			registerCheckSelectionCommand(mockContext, mockDeps);

			const commandCallback = vi.mocked(mockVscode.commands.registerCommand)
				.mock.calls[0][1] as () => Promise<void>;

			await commandCallback();

			expect(mockDeps.notifier.warn).toHaveBeenCalledWith(
				'No valid URL found in selection',
			);
		});

		it('should execute check when valid URL is found', async () => {
			const mockContext = {
				subscriptions: [],
			} as unknown as vscode.ExtensionContext;

			const mockDeps = {
				notifier: {
					info: vi.fn(),
					warn: vi.fn(),
					error: vi.fn(),
				},
				statusBar: {
					show: vi.fn(),
					hide: vi.fn(),
					dispose: vi.fn(),
				},
			};

			mockVscode.window.activeTextEditor = {
				selection: { start: 0, end: 20 },
				document: {
					getText: vi.fn().mockReturnValue('https://example.com'),
				},
			} as never;

			vi.mocked(urlUtils.extractUrlFromText).mockReturnValue(
				'https://example.com',
			);
			vi.mocked(checkModule.executeCheck).mockResolvedValue(undefined);

			const { registerCheckSelectionCommand } = await import(
				'./checkSelection'
			);
			registerCheckSelectionCommand(mockContext, mockDeps);

			const commandCallback = vi.mocked(mockVscode.commands.registerCommand)
				.mock.calls[0][1] as () => Promise<void>;

			await commandCallback();

			expect(checkModule.executeCheck).toHaveBeenCalledWith(
				'https://example.com',
				mockDeps,
				mockContext,
			);
		});
	});
});
