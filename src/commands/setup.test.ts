import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';

// Mock vscode
vi.mock('vscode', async () => {
	return {
		window: {
			showQuickPick: vi.fn(),
			showInformationMessage: vi.fn(),
			showWarningMessage: vi.fn(),
		},
		commands: {
			registerCommand: vi.fn((_, callback) => ({ dispose: vi.fn() })),
		},
	};
});

// Mock dependencies
vi.mock('../scraper/install', () => ({
	ensureBrowserInstalled: vi.fn(),
	showManualInstallInstructions: vi.fn(),
}));

vi.mock('../scraper/browser', () => ({
	isBrowserAvailable: vi.fn(),
}));

describe('setup', () => {
	let mockVscode: typeof vscode;
	let installModule: {
		ensureBrowserInstalled: ReturnType<typeof vi.fn>;
		showManualInstallInstructions: ReturnType<typeof vi.fn>;
	};
	let browserModule: { isBrowserAvailable: ReturnType<typeof vi.fn> };

	beforeEach(async () => {
		vi.clearAllMocks();
		mockVscode = await import('vscode');
		installModule = await import('../scraper/install');
		browserModule = await import('../scraper/browser');
	});

	describe('registerSetupCommand', () => {
		it('should register the command', async () => {
			const mockContext = {
				subscriptions: [],
			} as unknown as vscode.ExtensionContext;

			const { registerSetupCommand } = await import('./setup');
			registerSetupCommand(mockContext);

			expect(mockVscode.commands.registerCommand).toHaveBeenCalledWith(
				'scrape-le.setup',
				expect.any(Function),
			);
		});

		it('should handle install browser option', async () => {
			const mockContext = {
				subscriptions: [],
			} as unknown as vscode.ExtensionContext;

			vi.mocked(mockVscode.window.showQuickPick).mockResolvedValue({
				label: '$(cloud-download) Install Chromium Browser',
				action: 'install',
			} as never);

			vi.mocked(installModule.ensureBrowserInstalled).mockResolvedValue(true);

			const { registerSetupCommand } = await import('./setup');
			registerSetupCommand(mockContext);

			const commandCallback = vi.mocked(mockVscode.commands.registerCommand)
				.mock.calls[0][1] as () => Promise<void>;

			await commandCallback();

			expect(installModule.ensureBrowserInstalled).toHaveBeenCalled();
			expect(mockVscode.window.showInformationMessage).toHaveBeenCalledWith(
				expect.stringContaining('Chromium is ready'),
			);
		});

		it('should handle manual instructions option', async () => {
			const mockContext = {
				subscriptions: [],
			} as unknown as vscode.ExtensionContext;

			vi.mocked(mockVscode.window.showQuickPick).mockResolvedValue({
				label: '$(info) Manual Installation Instructions',
				action: 'manual',
			} as never);

			const { registerSetupCommand } = await import('./setup');
			registerSetupCommand(mockContext);

			const commandCallback = vi.mocked(mockVscode.commands.registerCommand)
				.mock.calls[0][1] as () => Promise<void>;

			await commandCallback();

			expect(installModule.showManualInstallInstructions).toHaveBeenCalled();
		});

		it('should handle test browser option when available', async () => {
			const mockContext = {
				subscriptions: [],
			} as unknown as vscode.ExtensionContext;

			vi.mocked(mockVscode.window.showQuickPick).mockResolvedValue({
				label: '$(check) Test Browser Installation',
				action: 'test',
			} as never);

			vi.mocked(browserModule.isBrowserAvailable).mockResolvedValue(true);

			const { registerSetupCommand } = await import('./setup');
			registerSetupCommand(mockContext);

			const commandCallback = vi.mocked(mockVscode.commands.registerCommand)
				.mock.calls[0][1] as () => Promise<void>;

			await commandCallback();

			expect(browserModule.isBrowserAvailable).toHaveBeenCalled();
			expect(mockVscode.window.showInformationMessage).toHaveBeenCalledWith(
				expect.stringContaining('Chromium is installed'),
			);
		});

		it('should handle test browser option when not available', async () => {
			const mockContext = {
				subscriptions: [],
			} as unknown as vscode.ExtensionContext;

			vi.mocked(mockVscode.window.showQuickPick).mockResolvedValue({
				label: '$(check) Test Browser Installation',
				action: 'test',
			} as never);

			vi.mocked(browserModule.isBrowserAvailable).mockResolvedValue(false);

			const { registerSetupCommand } = await import('./setup');
			registerSetupCommand(mockContext);

			const commandCallback = vi.mocked(mockVscode.commands.registerCommand)
				.mock.calls[0][1] as () => Promise<void>;

			await commandCallback();

			expect(mockVscode.window.showWarningMessage).toHaveBeenCalledWith(
				expect.stringContaining('Chromium is not installed'),
			);
		});

		it('should handle user cancellation', async () => {
			const mockContext = {
				subscriptions: [],
			} as unknown as vscode.ExtensionContext;

			vi.mocked(mockVscode.window.showQuickPick).mockResolvedValue(undefined);

			const { registerSetupCommand } = await import('./setup');
			registerSetupCommand(mockContext);

			const commandCallback = vi.mocked(mockVscode.commands.registerCommand)
				.mock.calls[0][1] as () => Promise<void>;

			await commandCallback();

			// Should not call any install functions
			expect(installModule.ensureBrowserInstalled).not.toHaveBeenCalled();
			expect(
				installModule.showManualInstallInstructions,
			).not.toHaveBeenCalled();
		});
	});
});
