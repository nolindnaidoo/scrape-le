import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode');

// The detector modules are imported directly by runDetections, so a throwing
// detector has to be installed at the module boundary.
vi.mock('./antibot', () => ({
	AntiBotDetector: { detectAntiBot: vi.fn() },
}));
vi.mock('./ratelimit', () => ({
	RateLimitDetector: { detectRateLimit: vi.fn() },
}));
vi.mock('./authentication', () => ({
	AuthenticationDetector: { detectAuthentication: vi.fn() },
}));
vi.mock('./robotstxt', () => ({
	RobotsTxtChecker: { fetchRobotsTxt: vi.fn() },
}));

import { AntiBotDetector } from './antibot';
import { AuthenticationDetector } from './authentication';
import { runDetections } from './index';
import { RateLimitDetector } from './ratelimit';
import { RobotsTxtChecker } from './robotstxt';

/**
 * A detector that throws must appear in the results.
 *
 * Each detector runs independently so one failure cannot take the whole check
 * down. But a failure used to leave its field absent, and every block in the
 * report skips absent fields — so a detector that errored rendered exactly
 * like one that was switched off, and the only record was a console.error the
 * user never opens.
 */
function options(enabled: Partial<Record<string, boolean>>) {
	return {
		detections: {
			rateLimit: false,
			antiBot: false,
			authentication: false,
			robotsTxt: false,
			...enabled,
		},
	} as never;
}

beforeEach(() => {
	vi.mocked(AntiBotDetector.detectAntiBot).mockReset();
});

describe('runDetections failure reporting', () => {
	it('records a failure rather than dropping the detection', async () => {
		vi.mocked(AntiBotDetector.detectAntiBot).mockRejectedValue(
			new Error('probe exploded'),
		);

		const result = await runDetections(
			null as never,
			null as never,
			'https://example.com',
			options({ antiBot: true }),
		);

		// The field stays absent — but the failure is now recorded, which is what
		// stops the report rendering silence as a clean result.
		expect(result.antiBot).toBeUndefined();
		expect(result.failures).toHaveLength(1);
		expect(result.failures?.[0]?.detection).toBe('antiBot');
		expect(result.failures?.[0]?.message).toBe('probe exploded');
	});

	it('leaves failures absent when every detection succeeds', async () => {
		vi.mocked(AntiBotDetector.detectAntiBot).mockResolvedValue({
			cloudflare: false,
			recaptcha: false,
			hcaptcha: false,
			datadome: false,
			perimeterx: false,
			details: [],
		} as never);

		const result = await runDetections(
			null as never,
			null as never,
			'https://example.com',
			options({ antiBot: true }),
		);

		expect(result.antiBot).toBeDefined();
		expect(result.failures).toBeUndefined();
	});

	it('leaves failures absent when nothing was requested', async () => {
		const result = await runDetections(
			null as never,
			null as never,
			'https://example.com',
			options({}),
		);
		expect(result.failures).toBeUndefined();
	});

	it('carries a message even when a non-Error is thrown', async () => {
		vi.mocked(AntiBotDetector.detectAntiBot).mockRejectedValue('plain string');

		const result = await runDetections(
			null as never,
			null as never,
			'https://example.com',
			options({ antiBot: true }),
		);

		expect(result.failures?.[0]?.message).toBe('plain string');
	});
});

describe('runDetections: every detector reports its own failure', () => {
	// Each detector has its own catch; covering one leaves the other three
	// unread, and a failure that is not recorded renders as a clean result.
	it('records a rate-limit failure', async () => {
		vi.mocked(RateLimitDetector.detectRateLimit).mockRejectedValue(
			new Error('headers unreadable'),
		);
		const result = await runDetections(
			null as never,
			null as never,
			'https://example.com',
			options({ rateLimit: true }),
		);
		expect(result.failures?.[0]?.detection).toBe('rateLimit');
	});

	it('records an authentication failure', async () => {
		vi.mocked(AuthenticationDetector.detectAuthentication).mockRejectedValue(
			new Error('page gone'),
		);
		const result = await runDetections(
			null as never,
			null as never,
			'https://example.com',
			options({ authentication: true }),
		);
		expect(result.failures?.[0]?.detection).toBe('authentication');
	});

	it('records a robots.txt failure', async () => {
		vi.mocked(RobotsTxtChecker.fetchRobotsTxt).mockRejectedValue(
			new Error('network down'),
		);
		const result = await runDetections(
			null as never,
			null as never,
			'https://example.com',
			options({ robotsTxt: true }),
		);
		expect(result.failures?.[0]?.detection).toBe('robotsTxt');
	});

	it('records several failures from one run', async () => {
		vi.mocked(RateLimitDetector.detectRateLimit).mockRejectedValue(
			new Error('a'),
		);
		vi.mocked(RobotsTxtChecker.fetchRobotsTxt).mockRejectedValue(
			new Error('b'),
		);
		const result = await runDetections(
			null as never,
			null as never,
			'https://example.com',
			options({ rateLimit: true, robotsTxt: true }),
		);
		expect(result.failures).toHaveLength(2);
	});
});
