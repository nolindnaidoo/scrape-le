/**
 * Anti-bot protection detection — drives the shared vendor signatures
 * in heuristics.ts: one header pass plus one page.evaluate round-trip
 * for all vendors.
 */

import type { Page, Response } from 'playwright-core';
import type { AntiBotDetection } from '../types';
import {
	ANTI_BOT_SIGNATURES,
	buildPageProbes,
	matchHeaders,
	type PageProbeResult,
	pageProbeScan,
} from './heuristics';

/**
 * Detects anti-bot measures on a page
 */
export async function detectAntiBot(
	page: Page,
	response: Response | null,
): Promise<AntiBotDetection> {
	try {
		const details: string[] = [];
		const detected: Record<string, boolean> = {};

		const headers = readHeaders(response);
		for (const signature of ANTI_BOT_SIGNATURES) {
			const headerDetail = matchHeaders(headers, signature);
			if (headerDetail !== null) {
				detected[signature.key] = true;
				details.push(headerDetail);
			}
		}

		const probeResult = await runPageProbe(page);
		for (const signature of ANTI_BOT_SIGNATURES) {
			const probe = probeResult?.[signature.key];
			if (!probe || detected[signature.key]) {
				continue;
			}
			// First matching evidence wins, so the label names how it was found.
			const evidence = probe.script
				? 'script src'
				: probe.selector
					? 'DOM element'
					: probe.global
						? 'window global'
						: null;
			if (evidence) {
				detected[signature.key] = true;
				details.push(`${signature.label} (${evidence})`);
			}
		}

		return Object.freeze({
			cloudflare: detected.cloudflare === true,
			recaptcha: detected.recaptcha === true,
			hcaptcha: detected.hcaptcha === true,
			datadome: detected.datadome === true,
			perimeterx: detected.perimeterx === true,
			details: Object.freeze(details),
		});
	} catch (error) {
		// Rethrown rather than swallowed into a default result. Returning the
		// all-clear on error made a crashed check indistinguishable from a clean
		// one — the report stated "Not detected" for a detection that never ran.
		// runDetections records the failure and the report shows it.
		throw error;
	}
}

function readHeaders(response: Response | null): Record<string, string> {
	if (!response) {
		return {};
	}
	try {
		return response.headers();
	} catch (error) {
		console.error('Error reading response headers:', error);
		return {};
	}
}

async function runPageProbe(page: Page): Promise<PageProbeResult> {
	try {
		return (await page.evaluate(
			pageProbeScan,
			buildPageProbes(),
		)) as PageProbeResult;
	} catch (error) {
		console.error('Error probing page for anti-bot vendors:', error);
		return {};
	}
}

export const AntiBotDetector = Object.freeze({
	detectAntiBot,
});
