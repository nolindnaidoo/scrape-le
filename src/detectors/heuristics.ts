/**
 * Shared detection heuristics.
 *
 * Every anti-bot vendor is described by one signature (response headers,
 * script-src substrings, DOM selectors, window globals) and all vendors
 * are probed with a single page.evaluate round-trip instead of the four
 * divergent copies v1.x carried.
 *
 * Honest limitations:
 * - Signatures are best-effort fingerprints of public integration
 *   patterns; vendors change them, and first-party proxied setups
 *   (e.g. Cloudflare without cf-* headers stripped) can evade them.
 * - A detected widget means the page CAN challenge you, not that it
 *   will; absence of a signature is not proof a site allows scraping.
 * - Signatures deliberately avoid ambiguous markers: [data-sitekey]
 *   alone is used by reCAPTCHA, hCaptcha AND Turnstile, and
 *   gstatic.com hosts fonts as well as captcha assets — neither is
 *   attributed to a specific vendor anymore (v1.x flagged any
 *   gstatic.com script as reCAPTCHA).
 */

export type VendorKey =
	| 'cloudflare'
	| 'recaptcha'
	| 'hcaptcha'
	| 'datadome'
	| 'perimeterx';

export type HeaderSignature = Readonly<{
	/** lowercased header name */
	name: string;
	/** when set, the header value must contain this substring (lowercased) */
	contains?: string;
}>;

export type VendorSignature = Readonly<{
	key: VendorKey;
	label: string;
	headers: readonly HeaderSignature[];
	scriptSubstrings: readonly string[];
	selectors: readonly string[];
	globals: readonly string[];
}>;

export const ANTI_BOT_SIGNATURES: readonly VendorSignature[] = Object.freeze([
	Object.freeze({
		key: 'cloudflare' as const,
		label: 'Cloudflare',
		headers: Object.freeze([
			Object.freeze({ name: 'cf-ray' }),
			Object.freeze({ name: 'cf-cache-status' }),
			Object.freeze({ name: 'cf-mitigated' }),
			Object.freeze({ name: 'server', contains: 'cloudflare' }),
		]),
		scriptSubstrings: Object.freeze(['challenges.cloudflare.com']),
		selectors: Object.freeze(['.cf-turnstile', '#challenge-form']),
		globals: Object.freeze(['turnstile']),
	}),
	Object.freeze({
		key: 'recaptcha' as const,
		label: 'reCAPTCHA',
		headers: Object.freeze([]),
		scriptSubstrings: Object.freeze(['recaptcha']),
		selectors: Object.freeze(['.g-recaptcha']),
		globals: Object.freeze(['grecaptcha']),
	}),
	Object.freeze({
		key: 'hcaptcha' as const,
		label: 'hCaptcha',
		headers: Object.freeze([]),
		scriptSubstrings: Object.freeze(['hcaptcha.com']),
		selectors: Object.freeze(['.h-captcha', '[data-hcaptcha-response]']),
		globals: Object.freeze(['hcaptcha']),
	}),
	Object.freeze({
		key: 'datadome' as const,
		label: 'DataDome',
		headers: Object.freeze([
			Object.freeze({ name: 'x-datadome-cid' }),
			Object.freeze({ name: 'x-dd-b' }),
			Object.freeze({ name: 'server', contains: 'datadome' }),
		]),
		scriptSubstrings: Object.freeze(['datadome.co', 'datadomecdn.com']),
		selectors: Object.freeze([]),
		globals: Object.freeze(['ddjskey']),
	}),
	Object.freeze({
		key: 'perimeterx' as const,
		label: 'PerimeterX',
		headers: Object.freeze([]),
		scriptSubstrings: Object.freeze([
			'px-cdn.net',
			'px-cloud.net',
			'perimeterx.net',
		]),
		selectors: Object.freeze(['#px-captcha']),
		globals: Object.freeze(['_pxAppId']),
	}),
]);

/**
 * Returns a human-readable detail when the response headers match the
 * signature, or null when they don't.
 */
export function matchHeaders(
	headers: Readonly<Record<string, string>>,
	signature: VendorSignature,
): string | null {
	for (const header of signature.headers) {
		const value = headers[header.name];
		if (value === undefined || value === '') {
			continue;
		}
		if (header.contains === undefined) {
			return `${signature.label} (${header.name} header)`;
		}
		if (value.toLowerCase().includes(header.contains)) {
			return `${signature.label} (${header.name} header)`;
		}
	}
	return null;
}

/** Result of the in-page probe, per vendor key. */
export type PageProbeResult = Readonly<
	Partial<
		Record<
			VendorKey,
			Readonly<{ script: boolean; selector: boolean; global: boolean }>
		>
	>
>;

/** Serializable probe input for the single page.evaluate round-trip. */
export type PageProbe = Readonly<{
	key: VendorKey;
	scriptSubstrings: readonly string[];
	selectors: readonly string[];
	globals: readonly string[];
}>;

export function buildPageProbes(): readonly PageProbe[] {
	return ANTI_BOT_SIGNATURES.map((s) => ({
		key: s.key,
		scriptSubstrings: s.scriptSubstrings,
		selectors: s.selectors,
		globals: s.globals,
	}));
}

/**
 * The function executed inside the page. Kept dependency-free and
 * side-effect-free: it receives the probes as its only argument and
 * returns plain JSON.
 */
export function pageProbeScan(
	probes: readonly PageProbe[],
): Record<string, { script: boolean; selector: boolean; global: boolean }> {
	const scripts = Array.from(document.getElementsByTagName('script')).map(
		(s) => s.src,
	);
	const result: Record<
		string,
		{ script: boolean; selector: boolean; global: boolean }
	> = {};
	for (const probe of probes) {
		result[probe.key] = {
			script: probe.scriptSubstrings.some((sub) =>
				scripts.some((src) => src.includes(sub)),
			),
			selector: probe.selectors.some((sel) => {
				try {
					return document.querySelector(sel) !== null;
				} catch {
					return false;
				}
			}),
			global: probe.globals.some((name) => name in window),
		};
	}
	return result;
}
