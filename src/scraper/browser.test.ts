import type { Browser } from 'playwright-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock playwright-core
vi.mock('playwright-core', () => ({
	chromium: {
		launch: vi.fn(),
	},
}));

describe('browser', () => {
	let chromiumMock: { launch: ReturnType<typeof vi.fn> };

	beforeEach(async () => {
		vi.clearAllMocks();
		const playwright = await import('playwright-core');
		chromiumMock = playwright.chromium as unknown as {
			launch: ReturnType<typeof vi.fn>;
		};
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe('createBrowser', () => {
		it('should launch browser successfully', async () => {
			const mockBrowser = {
				close: vi.fn(),
			} as unknown as Browser;

			chromiumMock.launch.mockResolvedValue(mockBrowser);

			const { createBrowser } = await import('./browser');
			const browser = await createBrowser();

			expect(browser).toBe(mockBrowser);
			expect(chromiumMock.launch).toHaveBeenCalledWith({
				headless: true,
				args: [
					'--no-sandbox',
					'--disable-setuid-sandbox',
					'--disable-dev-shm-usage',
					'--disable-accelerated-2d-canvas',
					'--disable-gpu',
				],
			});
		});

		it('should throw enhanced error on launch failure', async () => {
			chromiumMock.launch.mockRejectedValue(new Error('Launch failed'));

			const { createBrowser } = await import('./browser');

			await expect(createBrowser()).rejects.toThrow(
				'Failed to launch browser. Is Chromium installed?',
			);
		});
	});

	describe('closeBrowser', () => {
		it('should close browser successfully', async () => {
			const mockBrowser = {
				close: vi.fn().mockResolvedValue(undefined),
			} as unknown as Browser;

			const { closeBrowser } = await import('./browser');
			await closeBrowser(mockBrowser);

			expect(mockBrowser.close).toHaveBeenCalled();
		});

		it('should handle close errors gracefully', async () => {
			const mockBrowser = {
				close: vi.fn().mockRejectedValue(new Error('Close failed')),
			} as unknown as Browser;

			const consoleErrorSpy = vi
				.spyOn(console, 'error')
				.mockImplementation(() => {});

			const { closeBrowser } = await import('./browser');
			await closeBrowser(mockBrowser);

			expect(consoleErrorSpy).toHaveBeenCalledWith(
				'Error closing browser:',
				expect.any(Error),
			);

			consoleErrorSpy.mockRestore();
		});
	});

	describe('isBrowserAvailable', () => {
		it('should return true when browser launches successfully', async () => {
			const mockBrowser = {
				close: vi.fn().mockResolvedValue(undefined),
			} as unknown as Browser;

			chromiumMock.launch.mockResolvedValue(mockBrowser);

			const { isBrowserAvailable } = await import('./browser');
			const result = await isBrowserAvailable();

			expect(result).toBe(true);
			expect(mockBrowser.close).toHaveBeenCalled();
		});

		it('should return false when browser fails to launch', async () => {
			chromiumMock.launch.mockRejectedValue(new Error('Not installed'));

			const { isBrowserAvailable } = await import('./browser');
			const result = await isBrowserAvailable();

			expect(result).toBe(false);
		});
	});
});
