import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	ANTI_BOT_SIGNATURES,
	buildPageProbes,
	matchHeaders,
	pageProbeScan,
} from './heuristics';

function stubDom(init: {
	scripts?: string[];
	selectors?: string[];
	globals?: Record<string, unknown>;
}): void {
	vi.stubGlobal('document', {
		getElementsByTagName: () => (init.scripts ?? []).map((src) => ({ src })),
		querySelector: (sel: string) =>
			(init.selectors ?? []).includes(sel) ? {} : null,
	});
	vi.stubGlobal('window', init.globals ?? {});
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('buildPageProbes', () => {
	it('emits one probe per signature with matching keys', () => {
		const probes = buildPageProbes();
		expect(probes.map((p) => p.key)).toEqual(
			ANTI_BOT_SIGNATURES.map((s) => s.key),
		);
	});
});

describe('matchHeaders', () => {
	const cloudflare = ANTI_BOT_SIGNATURES.find((s) => s.key === 'cloudflare');
	if (!cloudflare) throw new Error('cloudflare signature missing');

	it('matches presence headers', () => {
		expect(matchHeaders({ 'cf-ray': 'x' }, cloudflare)).toBe(
			'Cloudflare (cf-ray header)',
		);
	});

	it('matches value-substring headers case-insensitively', () => {
		expect(matchHeaders({ server: 'CloudFlare' }, cloudflare)).toBe(
			'Cloudflare (server header)',
		);
	});

	it('ignores empty header values', () => {
		expect(matchHeaders({ 'cf-ray': '' }, cloudflare)).toBeNull();
	});

	it('returns null when nothing matches', () => {
		expect(matchHeaders({ server: 'nginx' }, cloudflare)).toBeNull();
	});
});

describe('pageProbeScan', () => {
	it('detects script src substrings', () => {
		stubDom({ scripts: ['https://www.google.com/recaptcha/api.js'] });

		const result = pageProbeScan(buildPageProbes());

		expect(result.recaptcha?.script).toBe(true);
		expect(result.hcaptcha?.script).toBe(false);
	});

	it('does not attribute plain gstatic.com scripts to reCAPTCHA', () => {
		stubDom({ scripts: ['https://fonts.gstatic.com/s/roboto/font.woff2'] });

		const result = pageProbeScan(buildPageProbes());

		expect(result.recaptcha?.script).toBe(false);
	});

	it('detects DOM selectors and survives selector errors', () => {
		vi.stubGlobal('document', {
			getElementsByTagName: () => [],
			querySelector: (sel: string) => {
				if (sel === '.h-captcha') return {};
				throw new Error('invalid selector');
			},
		});
		vi.stubGlobal('window', {});

		const result = pageProbeScan(buildPageProbes());

		expect(result.hcaptcha?.selector).toBe(true);
		expect(result.cloudflare?.selector).toBe(false);
	});

	it('detects window globals', () => {
		stubDom({ globals: { _pxAppId: 'PX123' } });

		const result = pageProbeScan(buildPageProbes());

		expect(result.perimeterx?.global).toBe(true);
		expect(result.datadome?.global).toBe(false);
	});
});
