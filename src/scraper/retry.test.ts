import type { Browser } from 'playwright-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CheckOptions, CheckResult } from '../types';
import { retryWithUserAgents, shouldRetry } from './retry';

vi.mock('node:fs/promises', () => ({ mkdir: vi.fn() }));

/**
 * The User-Agent retry matrix.
 *
 * A blocked check reports what resisted; the matrix reports what would work.
 * The decisions worth pinning are when it runs at all, that it stops at the
 * first clean result rather than surveying every agent, and that one agent
 * throwing does not abandon the rest.
 */

const OPTIONS: CheckOptions = Object.freeze({
	timeout: 30000,
	viewport: Object.freeze({ width: 1280, height: 720 }),
	userAgent: undefined,
	screenshotEnabled: true,
	screenshotPath: '/test/shots',
	screenshotFormat: 'png',
	screenshotQuality: 90,
	checkConsoleErrors: false,
	detections: Object.freeze({
		antiBot: true,
		rateLimit: false,
		robotsTxt: false,
		authentication: false,
	}),
});

function result(over: Partial<CheckResult> = {}): CheckResult {
	return Object.freeze({
		success: true,
		url: 'https://example.com',
		statusCode: 200,
		title: 'Example',
		loadTimeMs: 10,
		consoleErrors: Object.freeze([]),
		...over,
	});
}

const CLEAN_ANTIBOT = Object.freeze({
	cloudflare: false,
	recaptcha: false,
	hcaptcha: false,
	datadome: false,
	perimeterx: false,
	details: Object.freeze([]),
});

/** A browser whose pages resolve the given status codes, in order. */
function browserYielding(statuses: readonly (number | 'throw')[]): Browser {
	let i = 0;
	return {
		newPage: vi.fn().mockImplementation(async () => {
			const next = statuses[Math.min(i, statuses.length - 1)];
			i += 1;
			if (next === 'throw') throw new Error('navigation crashed');
			return {
				goto: vi.fn().mockResolvedValue({
					status: () => next,
					// The anti-bot detector reads response headers; a bare status
					// stub makes it throw and the attempt look like a crash.
					headers: () => ({}),
				}),
				title: vi.fn().mockResolvedValue('Example'),
				screenshot: vi.fn().mockResolvedValue(Buffer.from('x')),
				close: vi.fn().mockResolvedValue(undefined),
				on: vi.fn(),
			};
		}),
	} as unknown as Browser;
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('shouldRetry', () => {
	it('retries a failed check', () => {
		expect(shouldRetry(result({ success: false, error: 'timeout' }))).toBe(
			true,
		);
	});

	it('retries a check that tripped bot detection', () => {
		const detections = { antiBot: { ...CLEAN_ANTIBOT, cloudflare: true } };
		expect(shouldRetry(result({ detections }))).toBe(true);
	});

	it('does not retry a clean check', () => {
		// Re-running a page that already loaded costs the user a page load and
		// tells them nothing.
		const detections = { antiBot: CLEAN_ANTIBOT };
		expect(shouldRetry(result({ detections }))).toBe(false);
	});

	it('does not retry when no anti-bot detection ran', () => {
		expect(shouldRetry(result())).toBe(false);
	});
});

describe('retryWithUserAgents', () => {
	it('stops at the first agent that loads cleanly', async () => {
		// The point is to find a working configuration, not to survey every
		// agent — the rest would be page loads the user pays for and cannot use.
		const browser = browserYielding([200]);
		const attempts = await retryWithUserAgents(
			browser,
			'https://example.com',
			OPTIONS,
		);
		expect(attempts).toHaveLength(1);
		expect(attempts[0]?.outcome).toBe('ok');
		expect(attempts[0]?.label).toBe('Desktop Chrome');
	});

	it('reports every agent when none works', async () => {
		const browser = browserYielding([403, 403, 403]);
		const attempts = await retryWithUserAgents(
			browser,
			'https://example.com',
			OPTIONS,
		);
		expect(attempts).toHaveLength(3);
		expect(attempts.every((a) => a.outcome !== 'ok')).toBe(true);
	});

	it('records an agent that threw and carries on', async () => {
		// One agent crashing is a result about that agent, not a reason to
		// abandon the matrix.
		const browser = browserYielding(['throw', 200]);
		const attempts = await retryWithUserAgents(
			browser,
			'https://example.com',
			OPTIONS,
		);
		expect(attempts[0]?.outcome).toBe('failed');
		expect(attempts[0]?.error).toContain('navigation crashed');
		expect(attempts[1]?.outcome).toBe('ok');
	});

	it('skips the agent the user already configured', async () => {
		const browser = browserYielding([200]);
		const chrome =
			'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
		const attempts = await retryWithUserAgents(browser, 'https://example.com', {
			...OPTIONS,
			userAgent: chrome,
		});
		expect(attempts[0]?.label).not.toBe('Desktop Chrome');
	});

	it('reports progress for each agent it tries', async () => {
		const seen: string[] = [];
		const browser = browserYielding([403, 200]);
		await retryWithUserAgents(
			browser,
			'https://example.com',
			OPTIONS,
			(label) => seen.push(label),
		);
		expect(seen).toEqual(['Desktop Chrome', 'Desktop Firefox']);
	});

	it('does not take a screenshot on a retry', async () => {
		// The first attempt already captured one; a retry only needs the verdict.
		const browser = browserYielding([200]);
		await retryWithUserAgents(browser, 'https://example.com', OPTIONS);
		const page = await (
			browser.newPage as unknown as {
				mock: { results: { value: Promise<unknown> }[] };
			}
		).mock.results[0]?.value;
		expect(
			(page as { screenshot: { mock: { calls: unknown[] } } }).screenshot.mock
				.calls,
		).toHaveLength(0);
	});
});
