import { describe, expect, it } from 'vitest';
import { _outputChannels } from '../__mocks__/vscode';
import type { CheckResult } from '../types';
import { logCheckResult, showOutput } from './output';

// output.ts caches its channel at module level, so all tests share the
// first created channel; no _resetMockState() here.

function baseResult(overrides: Partial<CheckResult>): CheckResult {
	return {
		success: true,
		url: 'https://example.com',
		statusCode: 200,
		title: 'Example',
		loadTimeMs: 123,
		consoleErrors: [],
		...overrides,
	} as CheckResult;
}

function channelText(): string {
	return (_outputChannels()[0]?._lines ?? []).join('\n');
}

describe('output channel', () => {
	it('logs a success result with detections', () => {
		logCheckResult(
			baseResult({
				screenshotPath: '/ws/.vscode/scrape-le/example-com.png',
				consoleErrors: ['boom'],
				detections: {
					rateLimit: { detected: true, limit: '100', retryAfter: '60' },
					antiBot: {
						cloudflare: true,
						recaptcha: false,
						hcaptcha: false,
						datadome: false,
						perimeterx: true,
						details: ['Cloudflare (cf-ray header)', 'PerimeterX (script src)'],
					},
					robotsTxt: {
						exists: true,
						allowsCrawling: false,
						crawlDelay: 2,
						disallowedPaths: ['/a', '/b', '/c', '/d', '/e', '/f'],
						sitemaps: ['https://example.com/sitemap.xml'],
					},
					authentication: {
						required: true,
						type: 'form',
						loginUrl: 'https://example.com/login',
						indicators: ['Login form detected'],
					},
				},
			}),
		);

		const text = channelText();
		expect(text).toContain('✅ SUCCESS: https://example.com');
		expect(text).toContain('Status Code: 200');
		expect(text).toContain('Console Errors: 1');
		expect(text).toContain('Rate Limiting: Detected');
		expect(text).toContain('- Cloudflare: Yes');
		expect(text).toContain('- PerimeterX: Yes');
		expect(text).toContain('Allows Crawling: No');
		expect(text).toContain('... and 1 more');
		expect(text).toContain('Sitemap: https://example.com/sitemap.xml');
		expect(text).toContain('Authentication: Required');
		expect(text).toContain('Login URL: https://example.com/login');
	});

	it('logs a failure result', () => {
		logCheckResult(
			baseResult({
				success: false,
				statusCode: null,
				error: 'net::ERR_NAME_NOT_RESOLVED',
			}),
		);

		const text = channelText();
		expect(text).toContain('❌ FAILED: https://example.com');
		expect(text).toContain('Error: net::ERR_NAME_NOT_RESOLVED');
	});

	it('logs not-detected branches', () => {
		logCheckResult(
			baseResult({
				detections: {
					rateLimit: { detected: false },
					antiBot: {
						cloudflare: false,
						recaptcha: false,
						hcaptcha: false,
						datadome: false,
						perimeterx: false,
						details: [],
					},
					robotsTxt: {
						exists: false,
						allowsCrawling: true,
						disallowedPaths: [],
						sitemaps: [],
					},
					authentication: { required: false, indicators: [] },
				},
			}),
		);

		const text = channelText();
		expect(text).toContain('Rate Limiting: Not detected');
		expect(text).toContain('Anti-Bot Measures: None detected');
		expect(text).toContain('robots.txt: Not found');
		expect(text).toContain('Authentication: Not required');
	});

	it('showOutput reveals the channel', () => {
		showOutput();
		expect(_outputChannels()[0]?._shown).toBe(true);
	});
});
