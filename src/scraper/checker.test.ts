import type { Browser } from 'playwright-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CheckOptions } from '../types';
import { checkPageScrapeability } from './checker';

// Mock fs/promises
vi.mock('node:fs/promises', () => ({
	mkdir: vi.fn(),
}));

describe('checker', () => {
	const mockOptions: CheckOptions = Object.freeze({
		timeout: 30000,
		viewport: Object.freeze({
			width: 1280,
			height: 720,
		}),
		userAgent: undefined,
		screenshotEnabled: true,
		screenshotPath: '/test/screenshots',
		screenshotFormat: 'png',
		screenshotQuality: 90,
		checkConsoleErrors: true,
		detections: Object.freeze({
			antiBot: false,
			rateLimit: false,
			robotsTxt: false,
			authentication: false,
		}),
	});

	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('checkPageScrapeability', () => {
		it('should successfully check a reachable page', async () => {
			const _mockConsoleMessages: Array<{ type: string; text: string }> = [];
			const mockPage = {
				goto: vi.fn().mockResolvedValue({ status: () => 200 }),
				title: vi.fn().mockResolvedValue('Test Page'),
				screenshot: vi.fn().mockResolvedValue(Buffer.from('test')),
				close: vi.fn().mockResolvedValue(undefined),
				on: vi.fn((event, handler) => {
					// Don't trigger any console events for this test
				}),
			};

			const mockBrowser = {
				newPage: vi.fn().mockResolvedValue(mockPage),
			} as unknown as Browser;

			const result = await checkPageScrapeability(
				mockBrowser,
				'https://example.com',
				mockOptions,
			);

			expect(result.success).toBe(true);
			expect(result.url).toBe('https://example.com');
			expect(result.statusCode).toBe(200);
			expect(result.title).toBe('Test Page');
			expect(result.loadTimeMs).toBeGreaterThanOrEqual(0);
			expect(mockPage.close).toHaveBeenCalled();
		});

		it('should capture console errors when enabled', async () => {
			let consoleHandler:
				| ((msg: { type: () => string; text: () => string }) => void)
				| null = null;
			let pageErrorHandler: ((error: Error) => void) | null = null;

			const mockPage = {
				goto: vi.fn().mockImplementation(async () => {
					// Simulate console error during navigation
					if (consoleHandler) {
						consoleHandler({
							type: () => 'error',
							text: () => 'Test error',
						});
					}

					// Simulate page error
					if (pageErrorHandler) {
						pageErrorHandler(new Error('Page error'));
					}

					return { status: () => 200 };
				}),
				title: vi.fn().mockResolvedValue('Test Page'),
				screenshot: vi.fn().mockResolvedValue(Buffer.from('test')),
				close: vi.fn().mockResolvedValue(undefined),
				on: vi.fn((event, handler) => {
					if (event === 'console') {
						consoleHandler = handler;
					} else if (event === 'pageerror') {
						pageErrorHandler = handler;
					}
				}),
			};

			const mockBrowser = {
				newPage: vi.fn().mockResolvedValue(mockPage),
			} as unknown as Browser;

			const result = await checkPageScrapeability(
				mockBrowser,
				'https://example.com',
				mockOptions,
			);

			expect(result.success).toBe(true);
			expect(result.consoleErrors.length).toBeGreaterThanOrEqual(1);
			expect(result.consoleErrors).toContain('Test error');
		});

		it('should handle navigation failures', async () => {
			const mockPage = {
				goto: vi
					.fn()
					.mockRejectedValue(new Error('net::ERR_NAME_NOT_RESOLVED')),
				title: vi.fn().mockResolvedValue(''),
				screenshot: vi.fn().mockResolvedValue(Buffer.from('test')),
				close: vi.fn().mockResolvedValue(undefined),
				on: vi.fn(),
			};

			const mockBrowser = {
				newPage: vi.fn().mockResolvedValue(mockPage),
			} as unknown as Browser;

			const result = await checkPageScrapeability(
				mockBrowser,
				'https://invalid-domain-12345.com',
				mockOptions,
			);

			expect(result.success).toBe(false);
			expect(result.error).toContain('ERR_NAME_NOT_RESOLVED');
		});

		it('should handle screenshot capture', async () => {
			const mockPage = {
				goto: vi.fn().mockResolvedValue({ status: () => 200 }),
				title: vi.fn().mockResolvedValue('Test Page'),
				screenshot: vi.fn().mockResolvedValue(Buffer.from('screenshot-data')),
				close: vi.fn().mockResolvedValue(undefined),
				on: vi.fn(),
			};

			const mockBrowser = {
				newPage: vi.fn().mockResolvedValue(mockPage),
			} as unknown as Browser;

			const result = await checkPageScrapeability(
				mockBrowser,
				'https://example.com',
				mockOptions,
			);

			expect(result.screenshotPath).toBeDefined();
			expect(mockPage.screenshot).toHaveBeenCalled();
		});

		it('should skip screenshot when disabled', async () => {
			const optionsNoScreenshot: CheckOptions = {
				...mockOptions,
				screenshotEnabled: false,
			};

			const mockPage = {
				goto: vi.fn().mockResolvedValue({ status: () => 200 }),
				title: vi.fn().mockResolvedValue('Test Page'),
				screenshot: vi.fn(),
				close: vi.fn().mockResolvedValue(undefined),
				on: vi.fn(),
			};

			const mockBrowser = {
				newPage: vi.fn().mockResolvedValue(mockPage),
			} as unknown as Browser;

			const result = await checkPageScrapeability(
				mockBrowser,
				'https://example.com',
				optionsNoScreenshot,
			);

			expect(result.screenshotPath).toBeUndefined();
			expect(mockPage.screenshot).not.toHaveBeenCalled();
		});

		it('should skip console errors when disabled', async () => {
			const optionsNoConsole: CheckOptions = {
				...mockOptions,
				checkConsoleErrors: false,
			};

			const mockPage = {
				goto: vi.fn().mockResolvedValue({ status: () => 200 }),
				title: vi.fn().mockResolvedValue('Test Page'),
				screenshot: vi.fn().mockResolvedValue(Buffer.from('test')),
				close: vi.fn().mockResolvedValue(undefined),
				on: vi.fn(),
			};

			const mockBrowser = {
				newPage: vi.fn().mockResolvedValue(mockPage),
			} as unknown as Browser;

			await checkPageScrapeability(
				mockBrowser,
				'https://example.com',
				optionsNoConsole,
			);

			expect(mockPage.on).not.toHaveBeenCalled();
		});

		it('should close page even when navigation fails', async () => {
			const mockPage = {
				goto: vi.fn().mockRejectedValue(new Error('Navigation timeout')),
				title: vi.fn().mockResolvedValue(''),
				screenshot: vi.fn(),
				close: vi.fn().mockResolvedValue(undefined),
				on: vi.fn(),
			};

			const mockBrowser = {
				newPage: vi.fn().mockResolvedValue(mockPage),
			} as unknown as Browser;

			const result = await checkPageScrapeability(
				mockBrowser,
				'https://timeout.com',
				mockOptions,
			);

			expect(result.success).toBe(false);
			expect(result.error).toContain('Navigation timeout');
			expect(mockPage.close).toHaveBeenCalled(); // ← Page should be closed
		});

		it('should close page even when screenshot fails', async () => {
			const mockPage = {
				goto: vi.fn().mockResolvedValue({ status: () => 200 }),
				title: vi.fn().mockResolvedValue('Test Page'),
				screenshot: vi.fn().mockRejectedValue(new Error('Screenshot failed')),
				close: vi.fn().mockResolvedValue(undefined),
				on: vi.fn(),
			};

			const mockBrowser = {
				newPage: vi.fn().mockResolvedValue(mockPage),
			} as unknown as Browser;

			const result = await checkPageScrapeability(
				mockBrowser,
				'https://example.com',
				mockOptions,
			);

			// Should still return a result even if screenshot fails
			expect(result.success).toBe(true);
			expect(mockPage.close).toHaveBeenCalled(); // Page should be closed
		});
	});
});
