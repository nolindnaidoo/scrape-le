/**
 * Anti-bot detection tests
 */

import type { Page, Response } from 'playwright-core';
import { beforeEach, describe, expect, it } from 'vitest';
import { AntiBotDetector } from './antibot';
import type { PageProbeResult, VendorKey } from './heuristics';

const NO_HIT = { script: false, selector: false, global: false };

function probeResult(
	overrides: Partial<
		Record<VendorKey, { script: boolean; selector: boolean; global: boolean }>
	> = {},
): PageProbeResult {
	return {
		cloudflare: NO_HIT,
		recaptcha: NO_HIT,
		hcaptcha: NO_HIT,
		datadome: NO_HIT,
		perimeterx: NO_HIT,
		...overrides,
	};
}

function pageWithProbe(result: PageProbeResult): Page {
	return {
		evaluate: async () => result,
	} as unknown as Page;
}

describe('detectAntiBot', () => {
	let mockPage: Page;
	let mockResponse: Partial<Response>;

	beforeEach(() => {
		mockPage = pageWithProbe(probeResult());
		mockResponse = {
			headers: () => ({}),
		};
	});

	it('should detect no anti-bot measures on clean page', async () => {
		const result = await AntiBotDetector.detectAntiBot(
			mockPage,
			mockResponse as Response,
		);

		expect(result.cloudflare).toBe(false);
		expect(result.recaptcha).toBe(false);
		expect(result.hcaptcha).toBe(false);
		expect(result.datadome).toBe(false);
		expect(result.perimeterx).toBe(false);
		expect(result.details).toEqual([]);
	});

	it.each([
		['cf-ray', 'abc123'],
		['cf-cache-status', 'HIT'],
		['cf-mitigated', 'challenge'],
	])('should detect Cloudflare via %s header', async (name, value) => {
		mockResponse = { headers: () => ({ [name]: value }) };

		const result = await AntiBotDetector.detectAntiBot(
			mockPage,
			mockResponse as Response,
		);

		expect(result.cloudflare).toBe(true);
		expect(result.details).toContain(`Cloudflare (${name} header)`);
	});

	it('should detect Cloudflare via server header substring', async () => {
		mockResponse = { headers: () => ({ server: 'Cloudflare-nginx' }) };

		const result = await AntiBotDetector.detectAntiBot(
			mockPage,
			mockResponse as Response,
		);

		expect(result.cloudflare).toBe(true);
		expect(result.details).toContain('Cloudflare (server header)');
	});

	it('should NOT detect Cloudflare from an unrelated server header', async () => {
		mockResponse = { headers: () => ({ server: 'nginx' }) };

		const result = await AntiBotDetector.detectAntiBot(
			mockPage,
			mockResponse as Response,
		);

		expect(result.cloudflare).toBe(false);
	});

	it('should detect reCAPTCHA via script src', async () => {
		mockPage = pageWithProbe(
			probeResult({
				recaptcha: { script: true, selector: false, global: false },
			}),
		);

		const result = await AntiBotDetector.detectAntiBot(
			mockPage,
			mockResponse as Response,
		);

		expect(result.recaptcha).toBe(true);
		expect(result.details).toContain('reCAPTCHA (script src)');
	});

	it('should detect reCAPTCHA via window global', async () => {
		mockPage = pageWithProbe(
			probeResult({
				recaptcha: { script: false, selector: false, global: true },
			}),
		);

		const result = await AntiBotDetector.detectAntiBot(
			mockPage,
			mockResponse as Response,
		);

		expect(result.recaptcha).toBe(true);
		expect(result.details).toContain('reCAPTCHA (window global)');
	});

	it('should detect hCaptcha via DOM element', async () => {
		mockPage = pageWithProbe(
			probeResult({
				hcaptcha: { script: false, selector: true, global: false },
			}),
		);

		const result = await AntiBotDetector.detectAntiBot(
			mockPage,
			mockResponse as Response,
		);

		expect(result.hcaptcha).toBe(true);
		expect(result.details).toContain('hCaptcha (DOM element)');
	});

	it.each([['x-datadome-cid'], ['x-dd-b']])(
		'should detect DataDome via %s header',
		async (name) => {
			mockResponse = { headers: () => ({ [name]: 'test123' }) };

			const result = await AntiBotDetector.detectAntiBot(
				mockPage,
				mockResponse as Response,
			);

			expect(result.datadome).toBe(true);
			expect(result.details).toContain(`DataDome (${name} header)`);
		},
	);

	it('should detect DataDome via script src', async () => {
		mockPage = pageWithProbe(
			probeResult({
				datadome: { script: true, selector: false, global: false },
			}),
		);

		const result = await AntiBotDetector.detectAntiBot(
			mockPage,
			mockResponse as Response,
		);

		expect(result.datadome).toBe(true);
		expect(result.details).toContain('DataDome (script src)');
	});

	it('should detect PerimeterX via script src', async () => {
		mockPage = pageWithProbe(
			probeResult({
				perimeterx: { script: true, selector: false, global: false },
			}),
		);

		const result = await AntiBotDetector.detectAntiBot(
			mockPage,
			mockResponse as Response,
		);

		expect(result.perimeterx).toBe(true);
		expect(result.details).toContain('PerimeterX (script src)');
	});

	it('should report header detection once, not duplicated by the probe', async () => {
		mockResponse = { headers: () => ({ 'cf-ray': 'abc123' }) };
		mockPage = pageWithProbe(
			probeResult({
				cloudflare: { script: true, selector: true, global: true },
			}),
		);

		const result = await AntiBotDetector.detectAntiBot(
			mockPage,
			mockResponse as Response,
		);

		expect(result.cloudflare).toBe(true);
		expect(
			result.details.filter((d) => d.startsWith('Cloudflare')),
		).toHaveLength(1);
	});

	it('should detect multiple anti-bot systems', async () => {
		mockResponse = {
			headers: () => ({
				'cf-ray': 'abc123',
				'x-datadome-cid': 'test123',
			}),
		};

		const result = await AntiBotDetector.detectAntiBot(
			mockPage,
			mockResponse as Response,
		);

		expect(result.cloudflare).toBe(true);
		expect(result.datadome).toBe(true);
		expect(result.details.length).toBeGreaterThanOrEqual(2);
	});

	it('should handle null response gracefully', async () => {
		const result = await AntiBotDetector.detectAntiBot(mockPage, null);

		expect(result.cloudflare).toBe(false);
		expect(result.details).toEqual([]);
	});

	it('should handle page.evaluate errors gracefully', async () => {
		mockPage = {
			evaluate: async () => {
				throw new Error('Evaluation failed');
			},
		} as unknown as Page;

		const result = await AntiBotDetector.detectAntiBot(
			mockPage,
			mockResponse as Response,
		);

		expect(result.recaptcha).toBe(false);
		expect(result.hcaptcha).toBe(false);
	});

	it('should still probe the page when response.headers() throws', async () => {
		mockResponse = {
			headers: () => {
				throw new Error('Headers unavailable');
			},
		};
		mockPage = pageWithProbe(
			probeResult({
				recaptcha: { script: true, selector: false, global: false },
			}),
		);

		const result = await AntiBotDetector.detectAntiBot(
			mockPage,
			mockResponse as Response,
		);

		expect(result.cloudflare).toBe(false);
		expect(result.recaptcha).toBe(true);
	});

	it('should return frozen result object', async () => {
		const result = await AntiBotDetector.detectAntiBot(
			mockPage,
			mockResponse as Response,
		);

		expect(Object.isFrozen(result)).toBe(true);
		expect(Object.isFrozen(result.details)).toBe(true);
	});

	it('should return default when both headers and probe fail', async () => {
		mockPage = {
			evaluate: async () => {
				throw new Error('Fatal error');
			},
		} as unknown as Page;
		mockResponse = {
			headers: () => {
				throw new Error('Fatal error');
			},
		};

		const result = await AntiBotDetector.detectAntiBot(
			mockPage,
			mockResponse as Response,
		);

		expect(result.cloudflare).toBe(false);
		expect(result.recaptcha).toBe(false);
		expect(result.hcaptcha).toBe(false);
		expect(result.datadome).toBe(false);
		expect(result.perimeterx).toBe(false);
		expect(result.details).toEqual([]);
	});
});
