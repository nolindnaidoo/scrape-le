import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';

// Mock vscode
vi.mock('vscode', async () => {
	return {
		commands: {
			registerCommand: vi.fn((_, callback) => ({ dispose: vi.fn() })),
			executeCommand: vi.fn(),
		},
	};
});

describe('settings', () => {
	let mockVscode: typeof vscode;

	beforeEach(async () => {
		vi.clearAllMocks();
		mockVscode = await import('vscode');
	});

	describe('registerOpenSettingsCommand', () => {
		it('should register the openSettings command', async () => {
			const mockContext = {
				subscriptions: [],
			} as unknown as vscode.ExtensionContext;

			const { registerOpenSettingsCommand } = await import('./settings');
			registerOpenSettingsCommand(mockContext);

			expect(mockVscode.commands.registerCommand).toHaveBeenCalledWith(
				'scrape-le.openSettings',
				expect.any(Function),
			);
		});

		it('should execute workbench.action.openSettings when command is called', async () => {
			const mockContext = {
				subscriptions: [],
			} as unknown as vscode.ExtensionContext;

			vi.mocked(mockVscode.commands.executeCommand).mockResolvedValue(
				undefined,
			);

			const { registerOpenSettingsCommand } = await import('./settings');
			registerOpenSettingsCommand(mockContext);

			// Get the registered callback
			const registeredCallback = vi.mocked(mockVscode.commands.registerCommand)
				.mock.calls[0][1] as () => Promise<void>;

			await registeredCallback();

			expect(mockVscode.commands.executeCommand).toHaveBeenCalledWith(
				'workbench.action.openSettings',
				'scrape-le',
			);
		});
	});
});
