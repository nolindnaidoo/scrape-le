/**
 * Characterization tests: pin the CURRENT detector output, including known
 * bugs (robots.txt literal-prefix matching so wildcard rules never match,
 * agent-group handling that only honors '*' when it is the last grouped
 * User-agent line, empty-string rate-limit headers treated as absent,
 * '/auth' URL substring matching '/author', last-sitemap-wins).
 *
 * The in-page DOM callbacks passed to page.evaluate() run in a real browser
 * and cannot be pinned here; these tests characterize everything up to that
 * seam by scripting evaluate() results in call order.
 *
 * Behavior changes must update these snapshots in the same commit, so every
 * output diff is explicit.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page, Response } from 'playwright-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CheckOptions } from '../types';
import { detectAntiBot } from './antibot';
import { detectAuthentication } from './authentication';
import { runDetections } from './index';
import { detectRateLimit } from './ratelimit';
import { fetchRobotsTxt } from './robotstxt';

function fixture(name: string): string {
	return readFileSync(join(__dirname, '__fixtures__', name), 'utf8');
}

/** Fake Page: evaluate() pops scripted results in call order. */
function makePage(evaluateResults: unknown[], url = 'https://example.com/') {
	let call = 0;
	return {
		url: () => url,
		evaluate: async () => {
			const result = evaluateResults[call];
			call += 1;
			return result;
		},
	} as unknown as Page;
}

function makeResponse(headers: Record<string, string>, status = 200): Response {
	return {
		headers: () => headers,
		status: () => status,
	} as unknown as Response;
}

function stubRobotsFetch(body: string | null, ok = true): void {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => {
			if (body === null) {
				throw new Error('network down');
			}
			return { ok, text: async () => body };
		}),
	);
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('robots.txt characterization', () => {
	const cases: ReadonlyArray<{ fixtureFile: string; paths: string[] }> = [
		{
			fixtureFile: 'robots-simple.txt',
			paths: ['/', '/admin/panel', '/api/internal/x', '/apiary'],
		},
		{ fixtureFile: 'robots-disallow-all.txt', paths: ['/', '/anything'] },
		{
			fixtureFile: 'robots-multi-group.txt',
			paths: [
				'/google-only/x',
				'/everyone/x',
				'/grouped-star-last/x',
				'/grouped-star-first/x',
			],
		},
		{
			fixtureFile: 'robots-wildcards.txt',
			paths: ['/data.json', '/private/data', '/public/page'],
		},
	];

	for (const { fixtureFile, paths } of cases) {
		for (const path of paths) {
			it(`${fixtureFile} for path ${path}`, async () => {
				stubRobotsFetch(fixture(fixtureFile));
				const result = await fetchRobotsTxt(`https://example.com${path}`);
				expect(result).toMatchSnapshot();
			});
		}
	}

	it('missing robots.txt (404)', async () => {
		stubRobotsFetch('Not Found', false);
		expect(await fetchRobotsTxt('https://example.com/')).toMatchSnapshot();
	});

	it('network failure', async () => {
		stubRobotsFetch(null);
		expect(await fetchRobotsTxt('https://example.com/')).toMatchSnapshot();
	});
});

describe('rate-limit characterization', () => {
	const headerSets: Record<string, Record<string, string>> = JSON.parse(
		fixture('ratelimit-headers.json'),
	);

	for (const [name, headers] of Object.entries(headerSets)) {
		it(`headers: ${name}`, async () => {
			expect(await detectRateLimit(makeResponse(headers))).toMatchSnapshot();
		});
	}

	it('null response', async () => {
		expect(await detectRateLimit(null)).toMatchSnapshot();
	});
});

describe('anti-bot characterization', () => {
	const headerSets: Record<string, Record<string, string>> = JSON.parse(
		fixture('antibot-headers.json'),
	);

	for (const [name, headers] of Object.entries(headerSets)) {
		it(`headers only: ${name}`, async () => {
			// evaluate order: recaptcha, hcaptcha, datadome, perimeter81
			const page = makePage([false, false, false, false]);
			const result = await detectAntiBot(page, makeResponse(headers));
			expect(result).toMatchSnapshot();
		});
	}

	it('all script probes positive, clean headers', async () => {
		const page = makePage([true, true, true, true]);
		const result = await detectAntiBot(page, makeResponse({ server: 'nginx' }));
		expect(result).toMatchSnapshot();
	});

	it('null response with clean page', async () => {
		const page = makePage([false, false, false, false]);
		expect(await detectAntiBot(page, null)).toMatchSnapshot();
	});
});

describe('authentication characterization', () => {
	// evaluate order: login-form probe, keyword probe; then page.url() check
	const noForm = { hasPasswordInput: false };
	const noKeywords = { found: false };

	it('HTTP 401', async () => {
		const page = makePage([noForm, noKeywords]);
		expect(await detectAuthentication(page, 401)).toMatchSnapshot();
	});

	it('HTTP 403', async () => {
		const page = makePage([noForm, noKeywords]);
		expect(await detectAuthentication(page, 403)).toMatchSnapshot();
	});

	it('login form with username and action', async () => {
		const page = makePage([
			{
				hasPasswordInput: true,
				hasForm: true,
				hasUsernameInput: true,
				action: 'https://example.com/login',
			},
			noKeywords,
		]);
		expect(await detectAuthentication(page, 200)).toMatchSnapshot();
	});

	it('bare password input outside a form', async () => {
		const page = makePage([
			{ hasPasswordInput: true, hasForm: false },
			noKeywords,
		]);
		expect(await detectAuthentication(page, 200)).toMatchSnapshot();
	});

	it('keyword alone is not enough', async () => {
		const page = makePage([noForm, { found: true, keyword: 'sign in' }]);
		expect(await detectAuthentication(page, 200)).toMatchSnapshot();
	});

	it('keyword plus /auth-substring URL false positive (/author)', async () => {
		const page = makePage(
			[noForm, { found: true, keyword: 'sign in' }],
			'https://example.com/author/jane',
		);
		expect(await detectAuthentication(page, 200)).toMatchSnapshot();
	});

	it('nothing detected', async () => {
		const page = makePage([noForm, noKeywords]);
		expect(await detectAuthentication(page, 200)).toMatchSnapshot();
	});
});

describe('runDetections aggregation characterization', () => {
	const options: CheckOptions = Object.freeze({
		timeout: 30000,
		viewport: { width: 1280, height: 720 },
		userAgent: undefined,
		screenshotEnabled: false,
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
	});

	it('all detections enabled on a clean page', async () => {
		stubRobotsFetch(fixture('robots-simple.txt'));
		// evaluate order across detectors is not deterministic between the
		// anti-bot and auth detectors (they run in Promise.all), but every
		// scripted probe returns a "nothing found" shape valid for both.
		const page = {
			url: () => 'https://example.com/',
			evaluate: async () => false,
		} as unknown as Page;
		const result = await runDetections(
			page,
			makeResponse({ server: 'nginx' }),
			'https://example.com/',
			options,
		);
		expect(result).toMatchSnapshot();
	});

	it('all detections disabled returns empty object', async () => {
		const page = makePage([]);
		const result = await runDetections(
			page,
			makeResponse({}),
			'https://example.com/',
			{
				...options,
				detections: {
					antiBot: false,
					rateLimit: false,
					robotsTxt: false,
					authentication: false,
				},
			},
		);
		expect(result).toMatchSnapshot();
	});
});
