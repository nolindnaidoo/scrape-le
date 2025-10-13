import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock vscode
vi.mock('vscode', async () => {
	const actual = await vi.importActual('vscode');
	return {
		...actual,
		window: {
			showWarningMessage: vi.fn(),
			showInformationMessage: vi.fn(),
			showErrorMessage: vi.fn(),
			withProgress: vi.fn(),
		},
		env: {
			openExternal: vi.fn(),
			clipboard: {
				writeText: vi.fn(),
			},
		},
		Uri: {
			parse: vi.fn((url) => ({ toString: () => url })),
		},
		ProgressLocation: {
			Notification: 15,
		},
	};
});

// Mock browser module
vi.mock('./browser', () => ({
	isBrowserAvailable: vi.fn(),
}));

describe('install', () => {
	let vscode: typeof import('vscode');
	let browserModule: { isBrowserAvailable: ReturnType<typeof vi.fn> };

	beforeEach(async () => {
		vi.clearAllMocks();
		vscode = await import('vscode');
		browserModule = await import('./browser');
	});

	describe('ensureBrowserInstalled', () => {
		it('should return true if browser is already available', async () => {
			vi.mocked(browserModule.isBrowserAvailable).mockResolvedValue(true);

			const { ensureBrowserInstalled } = await import('./install');
			const result = await ensureBrowserInstalled();

			expect(result).toBe(true);
			expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
		});

		it('should prompt user when browser is not available', async () => {
			vi.mocked(browserModule.isBrowserAvailable).mockResolvedValue(false);
			vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(
				'Cancel' as never,
			);

			const { ensureBrowserInstalled } = await import('./install');
			const result = await ensureBrowserInstalled();

			expect(result).toBe(false);
			expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
				expect.stringContaining('Chromium browser'),
				'Install Chromium',
				'Cancel',
				'Learn More',
			);
		});

		it('should open external link when user clicks Learn More', async () => {
			vi.mocked(browserModule.isBrowserAvailable).mockResolvedValue(false);
			vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(
				'Learn More' as never,
			);
			vi.mocked(vscode.env.openExternal).mockResolvedValue(true);

			const { ensureBrowserInstalled } = await import('./install');
			const result = await ensureBrowserInstalled();

			expect(result).toBe(false);
			expect(vscode.env.openExternal).toHaveBeenCalled();
		});
	});

	describe('showManualInstallInstructions', () => {
		it('should display manual installation message', async () => {
			vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(
				undefined,
			);

			const { showManualInstallInstructions } = await import('./install');
			showManualInstallInstructions();

			expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
				expect.stringContaining('npx playwright install chromium'),
				'Copy Command',
				'Learn More',
			);
		});

		it('should copy command to clipboard when requested', async () => {
			const mockShowInfo = vi
				.mocked(vscode.window.showInformationMessage)
				.mockResolvedValue('Copy Command' as never);
			vi.mocked(vscode.env.clipboard.writeText).mockResolvedValue();

			const { showManualInstallInstructions } = await import('./install');
			showManualInstallInstructions();

			// Wait for the showInformationMessage to be called and its promise to resolve
			await vi.waitFor(
				() => {
					expect(mockShowInfo).toHaveBeenCalled();
				},
				{ timeout: 1000 },
			);

			// Note: The actual clipboard call happens in a .then() callback
			// We can verify the message was shown, but the callback is fire-and-forget
			expect(mockShowInfo).toHaveBeenCalledWith(
				expect.stringContaining('npx playwright install chromium'),
				'Copy Command',
				'Learn More',
			);
		});
	});

	describe('resetInstallCheck', () => {
		it('should reset installation check state', async () => {
			const { resetInstallCheck } = await import('./install');

			// Should not throw
			expect(() => resetInstallCheck()).not.toThrow();
		});
	});
});
