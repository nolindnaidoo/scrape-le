import { beforeEach, describe, expect, it } from 'vitest';
import type * as vscode from 'vscode';
import {
	_createExtensionContext,
	_outputChannels,
	_resetMockState,
} from '../__mocks__/vscode';
import type { CheckResult } from '../types';
import {
	disposeOutput,
	logCheckResult,
	logLine,
	registerOutput,
	showOutput,
} from './output';

// output.ts keeps its channel at module level, so a test that reads the
// mock's first channel needs the module's one released as well as the
// mock's list cleared; with only the list cleared, every test after the
// first found no channel at all, and the suite depended on its order.
beforeEach(() => {
	_resetMockState();
	disposeOutput();
});

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
						agent: '*',
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

	it('says there was no response rather than printing "null" as a status', () => {
		logCheckResult(baseResult({ statusCode: null }));

		const text = channelText();
		expect(text).toContain(
			'Status Code: none (no response for the navigation)',
		);
		expect(text).not.toContain('null');
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
						agent: '*',
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

	it('states the assumed disallow when robots.txt could not be read', () => {
		logCheckResult(
			baseResult({
				detections: {
					robotsTxt: {
						agent: '*',
						exists: false,
						allowsCrawling: false,
						disallowedPaths: [],
						sitemaps: [],
						unreachable: 'HTTP 503',
					},
				},
			}),
		);

		const text = channelText();
		expect(text).toContain('robots.txt: Could not be read (HTTP 503)');
		expect(text).toContain('Allows Crawling: No');
		expect(text).toContain('RFC 9309');
		expect(text).not.toContain('robots.txt: Not found');
	});

	it('showOutput reveals the channel', () => {
		showOutput();
		expect(_outputChannels()[0]?._shown).toBe(true);
	});
});

describe('output channel lifetime', () => {
	it('is released on deactivation, and a later log starts a fresh one', () => {
		const context =
			_createExtensionContext() as unknown as vscode.ExtensionContext;
		registerOutput(context);
		logLine('first session');
		expect(_outputChannels()).toHaveLength(1);

		for (const subscription of context.subscriptions) subscription.dispose();
		expect(_outputChannels()[0]?._disposed).toBe(true);

		// A second dispose is harmless, and the next log does not write into
		// the released channel.
		for (const subscription of context.subscriptions) subscription.dispose();
		logLine('second session');
		expect(_outputChannels()).toHaveLength(2);
		expect(_outputChannels()[1]?._disposed).toBe(false);
		expect(_outputChannels()[1]?._lines).toEqual(['second session']);
	});

	it('registers the release even when no channel is ever created', () => {
		const context =
			_createExtensionContext() as unknown as vscode.ExtensionContext;
		registerOutput(context);
		expect(context.subscriptions).toHaveLength(1);
		for (const subscription of context.subscriptions) subscription.dispose();
		expect(_outputChannels()).toHaveLength(0);
	});
});
