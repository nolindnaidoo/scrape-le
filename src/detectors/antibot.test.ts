/**
 * Anti-bot detection tests
 */

import type { Page, Response } from 'playwright-core';
import { beforeEach, describe, expect, it } from 'vitest';
import { detectAntiBotMeasures } from './antibot';

describe('detectAntiBotMeasures', () => {
	let mockPage: Partial<Page>;
	let mockResponse: Partial<Response>;

	beforeEach(() => {
		mockPage = {
			evaluate: async (fn: any) => false,
		};

		mockResponse = {
			headers: () => ({}),
		};
	});

	it('should detect no anti-bot measures on clean page', async () => {
		const result = await detectAntiBotMeasures(
			mockPage as Page,
			mockResponse as Response,
		);

		expect(result.cloudflare).toBe(false);
		expect(result.recaptcha).toBe(false);
		expect(result.hcaptcha).toBe(false);
		expect(result.datadome).toBe(false);
		expect(result.perimeter81).toBe(false);
		expect(result.details).toEqual([]);
	});

	it('should detect Cloudflare via cf-ray header', async () => {
		mockResponse = {
			headers: () => ({
				'cf-ray': 'abc123',
			}),
		};

		const result = await detectAntiBotMeasures(
			mockPage as Page,
			mockResponse as Response,
		);

		expect(result.cloudflare).toBe(true);
		expect(result.details).toContain('Cloudflare (cf-ray header detected)');
	});

	it('should detect Cloudflare via cf-cache-status header', async () => {
		mockResponse = {
			headers: () => ({
				'cf-cache-status': 'HIT',
			}),
		};

		const result = await detectAntiBotMeasures(
			mockPage as Page,
			mockResponse as Response,
		);

		expect(result.cloudflare).toBe(true);
		expect(result.details).toContain(
			'Cloudflare (cf-cache-status header detected)',
		);
	});

	it('should detect Cloudflare via server header', async () => {
		mockResponse = {
			headers: () => ({
				server: 'cloudflare',
			}),
		};

		const result = await detectAntiBotMeasures(
			mockPage as Page,
			mockResponse as Response,
		);

		expect(result.cloudflare).toBe(true);
		expect(result.details).toContain('Cloudflare (server header)');
	});

	it('should detect reCAPTCHA via script', async () => {
		mockPage = {
			evaluate: async (fn: any) => {
				// Simulate reCAPTCHA script present
				return !!fn.toString().includes('recaptcha');
			},
		};

		const result = await detectAntiBotMeasures(
			mockPage as Page,
			mockResponse as Response,
		);

		expect(result.recaptcha).toBe(true);
		expect(result.details).toContain('reCAPTCHA detected');
	});

	it('should detect hCaptcha via script', async () => {
		let callCount = 0;
		mockPage = {
			evaluate: async (fn: any) => {
				callCount++;
				// First call is for reCAPTCHA, second for hCaptcha
				return callCount === 2;
			},
		};

		const result = await detectAntiBotMeasures(
			mockPage as Page,
			mockResponse as Response,
		);

		expect(result.hcaptcha).toBe(true);
		expect(result.details).toContain('hCaptcha detected');
	});

	it('should detect DataDome via headers', async () => {
		mockResponse = {
			headers: () => ({
				'x-datadome-cid': 'test123',
			}),
		};

		const result = await detectAntiBotMeasures(
			mockPage as Page,
			mockResponse as Response,
		);

		expect(result.datadome).toBe(true);
		expect(result.details).toContain('DataDome (headers detected)');
	});

	it('should detect DataDome via x-dd-b header', async () => {
		mockResponse = {
			headers: () => ({
				'x-dd-b': 'test',
			}),
		};

		const result = await detectAntiBotMeasures(
			mockPage as Page,
			mockResponse as Response,
		);

		expect(result.datadome).toBe(true);
		expect(result.details).toContain('DataDome (headers detected)');
	});

	it('should detect DataDome via script', async () => {
		let callCount = 0;
		mockPage = {
			evaluate: async (fn: any) => {
				callCount++;
				// Third call is for DataDome
				return callCount === 3;
			},
		};

		const result = await detectAntiBotMeasures(
			mockPage as Page,
			mockResponse as Response,
		);

		expect(result.datadome).toBe(true);
		expect(result.details).toContain('DataDome (script detected)');
	});

	it('should detect Perimeter81 via headers', async () => {
		mockResponse = {
			headers: () => ({
				'x-per-request-id': 'test123',
			}),
		};

		const result = await detectAntiBotMeasures(
			mockPage as Page,
			mockResponse as Response,
		);

		expect(result.perimeter81).toBe(true);
		expect(result.details).toContain('Perimeter81 (headers detected)');
	});

	it('should detect Perimeter81 via x-per-session-id header', async () => {
		mockResponse = {
			headers: () => ({
				'x-per-session-id': 'test',
			}),
		};

		const result = await detectAntiBotMeasures(
			mockPage as Page,
			mockResponse as Response,
		);

		expect(result.perimeter81).toBe(true);
		expect(result.details).toContain('Perimeter81 (headers detected)');
	});

	it('should detect Perimeter81 via script', async () => {
		let callCount = 0;
		mockPage = {
			evaluate: async (fn: any) => {
				callCount++;
				// Fourth call is for Perimeter81
				return callCount === 4;
			},
		};

		const result = await detectAntiBotMeasures(
			mockPage as Page,
			mockResponse as Response,
		);

		expect(result.perimeter81).toBe(true);
		expect(result.details).toContain('Perimeter81 (script detected)');
	});

	it('should detect multiple anti-bot systems', async () => {
		mockResponse = {
			headers: () => ({
				'cf-ray': 'abc123',
				'x-datadome-cid': 'test123',
			}),
		};

		const result = await detectAntiBotMeasures(
			mockPage as Page,
			mockResponse as Response,
		);

		expect(result.cloudflare).toBe(true);
		expect(result.datadome).toBe(true);
		expect(result.details.length).toBeGreaterThanOrEqual(2);
	});

	it('should handle null response gracefully', async () => {
		const result = await detectAntiBotMeasures(mockPage as Page, null);

		expect(result.cloudflare).toBe(false);
		expect(result.details).toEqual([]);
	});

	it('should handle page.evaluate errors gracefully', async () => {
		mockPage = {
			evaluate: async () => {
				throw new Error('Evaluation failed');
			},
		};

		const result = await detectAntiBotMeasures(
			mockPage as Page,
			mockResponse as Response,
		);

		expect(result.recaptcha).toBe(false);
		expect(result.hcaptcha).toBe(false);
	});

	it('should handle response.headers() errors gracefully', async () => {
		mockResponse = {
			headers: () => {
				throw new Error('Headers unavailable');
			},
		};

		const result = await detectAntiBotMeasures(
			mockPage as Page,
			mockResponse as Response,
		);

		expect(result.cloudflare).toBe(false);
	});

	it('should return frozen result object', async () => {
		const result = await detectAntiBotMeasures(
			mockPage as Page,
			mockResponse as Response,
		);

		expect(Object.isFrozen(result)).toBe(true);
		expect(Object.isFrozen(result.details)).toBe(true);
	});

	it('should handle detection errors and return default', async () => {
		// Force error by making evaluate throw
		mockPage = {
			evaluate: async () => {
				throw new Error('Fatal error');
			},
		};

		// Make headers also throw to trigger catch in main function
		mockResponse = {
			headers: () => {
				throw new Error('Fatal error');
			},
		};

		const result = await detectAntiBotMeasures(
			mockPage as Page,
			mockResponse as Response,
		);

		expect(result.cloudflare).toBe(false);
		expect(result.recaptcha).toBe(false);
		expect(result.hcaptcha).toBe(false);
		expect(result.datadome).toBe(false);
		expect(result.perimeter81).toBe(false);
		expect(result.details).toEqual([]);
	});
});
