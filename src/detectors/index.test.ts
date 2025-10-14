/**
 * Detectors index tests
 */

import type { Page, Response } from 'playwright-core';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CheckOptions } from '../types';
import { runDetections } from './index';

describe('runDetections', () => {
	let mockPage: Partial<Page>;
	let mockResponse: Partial<Response>;
	let mockOptions: CheckOptions;

	beforeEach(() => {
		mockPage = {
			url: () => 'https://example.com',
			evaluate: async (fn: any) => false,
		};

		mockResponse = {
			headers: () => ({}),
			status: () => 200,
		};

		mockOptions = {
			timeout: 30000,
			viewport: {
				width: 1280,
				height: 720,
			},
			userAgent: undefined,
			screenshotEnabled: true,
			screenshotPath: '.vscode/scrape-le',
			screenshotFormat: 'png',
			screenshotQuality: 90,
			checkConsoleErrors: true,
			detections: {
				antiBot: true,
				rateLimit: true,
				robotsTxt: true,
				authentication: true,
			},
		} as const;
	});

	it('should return empty object when all detections disabled', async () => {
		const disabledOptions: CheckOptions = {
			...mockOptions,
			detections: {
				antiBot: false,
				rateLimit: false,
				robotsTxt: false,
				authentication: false,
			},
		};

		const result = await runDetections(
			mockPage as Page,
			mockResponse as Response,
			'https://example.com',
			disabledOptions,
		);

		expect(result).toBeDefined();
		expect(Object.keys(result)).toHaveLength(0);
	});

	it('should run all detections when enabled', async () => {
		const result = await runDetections(
			mockPage as Page,
			mockResponse as Response,
			'https://example.com',
			mockOptions,
		);

		expect(result).toBeDefined();
		expect(result.antiBot).toBeDefined();
		expect(result.rateLimit).toBeDefined();
		expect(result.robotsTxt).toBeDefined();
		expect(result.authentication).toBeDefined();
	}, 10000);

	it('should only run enabled detections', async () => {
		const partialOptions: CheckOptions = {
			...mockOptions,
			detections: {
				antiBot: true,
				rateLimit: false,
				robotsTxt: false,
				authentication: false,
			},
		};

		const result = await runDetections(
			mockPage as Page,
			mockResponse as Response,
			'https://example.com',
			partialOptions,
		);

		expect(result).toBeDefined();
		expect(result.antiBot).toBeDefined();
		expect(result.rateLimit).toBeUndefined();
		expect(result.robotsTxt).toBeUndefined();
		expect(result.authentication).toBeUndefined();
	});

	it('should detect anti-bot measures', async () => {
		mockResponse = {
			headers: () => ({
				'cf-ray': 'abc123',
			}),
			status: () => 200,
		};

		const result = await runDetections(
			mockPage as Page,
			mockResponse as Response,
			'https://example.com',
			mockOptions,
		);

		expect(result.antiBot?.cloudflare).toBe(true);
	}, 10000);

	it('should detect rate limits', async () => {
		mockResponse = {
			headers: () => ({
				'x-ratelimit-limit': '100',
				'x-ratelimit-remaining': '95',
			}),
			status: () => 200,
		};

		const result = await runDetections(
			mockPage as Page,
			mockResponse as Response,
			'https://example.com',
			mockOptions,
		);

		expect(result.rateLimit?.detected).toBe(true);
		expect(result.rateLimit?.limit).toBe('100');
	}, 10000);

	it('should detect authentication requirements', async () => {
		mockResponse = {
			...mockResponse,
			status: () => 401,
		};

		const result = await runDetections(
			mockPage as Page,
			mockResponse as Response,
			'https://example.com',
			mockOptions,
		);

		expect(result.authentication?.required).toBe(true);
		expect(result.authentication?.indicators).toContain(
			'HTTP 401 Unauthorized',
		);
	});

	it('should return frozen result object', async () => {
		const result = await runDetections(
			mockPage as Page,
			mockResponse as Response,
			'https://example.com',
			mockOptions,
		);

		expect(Object.isFrozen(result)).toBe(true);
	});

	it('should handle errors gracefully', async () => {
		mockPage = {
			url: () => {
				throw new Error('Fatal error');
			},
			evaluate: async () => {
				throw new Error('Fatal error');
			},
		};

		const result = await runDetections(
			mockPage as Page,
			mockResponse as Response,
			'https://example.com',
			mockOptions,
		);

		// Should still return results even with errors
		expect(result).toBeDefined();
	});

	it('should handle null response for rate limit detection', async () => {
		const result = await runDetections(
			mockPage as Page,
			null,
			'https://example.com',
			mockOptions,
		);

		expect(result.rateLimit?.detected).toBe(false);
	});

	it('should handle robots.txt fetch for URL', async () => {
		const result = await runDetections(
			mockPage as Page,
			mockResponse as Response,
			'https://example.com',
			mockOptions,
		);

		// robots.txt detection should be present
		expect(result.robotsTxt).toBeDefined();
		expect(result.robotsTxt?.exists).toBeDefined();
	}, 10000);

	it('should combine multiple detections', async () => {
		mockResponse = {
			headers: () => ({
				'cf-ray': 'abc123',
				'x-ratelimit-limit': '100',
			}),
			status: () => 401,
		};

		const result = await runDetections(
			mockPage as Page,
			mockResponse as Response,
			'https://example.com',
			mockOptions,
		);

		expect(result.antiBot?.cloudflare).toBe(true);
		expect(result.rateLimit?.detected).toBe(true);
		expect(result.authentication?.required).toBe(true);
	}, 10000);
});
