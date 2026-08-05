import type { Browser } from 'playwright-core';
import type { CheckOptions, CheckResult, UserAgentAttempt } from '../types';
import { checkPageScrapeability } from './checker';

/**
 * Re-checking a URL under different User-Agents.
 *
 * A check that fails or trips bot detection tells you the page resisted, not
 * what would have worked. Running the same check under a few common agents
 * turns "blocked" into "blocked as headless Chromium, fine as desktop Chrome —
 * set browser.userAgent to this", which is the answer the user actually needs.
 *
 * This is diagnosis, not evasion: it varies one header that every HTTP client
 * lets you set, and reports what it observed. It does not patch the automation
 * fingerprint or attempt to defeat a challenge.
 */

/** The agents tried, in order. Kept short — each one is a full page load. */
const CANDIDATE_AGENTS: ReadonlyArray<
	Readonly<{ label: string; value: string }>
> = Object.freeze([
	Object.freeze({
		label: 'Desktop Chrome',
		value:
			'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
	}),
	Object.freeze({
		label: 'Desktop Firefox',
		value:
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
	}),
	Object.freeze({
		label: 'Mobile Safari',
		value:
			'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
	}),
]);

/** Anti-bot measures or an outright failure are what make a retry worth doing. */
export function shouldRetry(result: CheckResult): boolean {
	if (!result.success) return true;

	const ab = result.detections?.antiBot;
	if (!ab) return false;
	return (
		ab.cloudflare || ab.recaptcha || ab.hcaptcha || ab.datadome || ab.perimeterx
	);
}

function summarise(result: CheckResult): UserAgentAttempt['outcome'] {
	if (!result.success) return 'failed';
	// A page that answers 403 or 429 loaded in the sense that navigation
	// resolved, but it did not work — reporting that agent as the fix would
	// send the user off to configure something that is still blocked.
	if (result.statusCode !== null && result.statusCode >= 400) return 'failed';
	return shouldRetry(result) ? 'bot-detected' : 'ok';
}

/**
 * Re-run the check under each candidate agent until one comes back clean.
 *
 * Stops at the first clean result — the point is to find a working
 * configuration, not to survey every agent. Returns the attempts in order so
 * the report can show what was tried, including the ones that did not work.
 */
export async function retryWithUserAgents(
	browser: Browser,
	url: string,
	options: CheckOptions,
	onAttempt?: (label: string) => void,
): Promise<readonly UserAgentAttempt[]> {
	const attempts: UserAgentAttempt[] = [];

	for (const agent of CANDIDATE_AGENTS) {
		// A user who already set an agent has made their choice; re-running the
		// identical request would only cost them a page load.
		if (options.userAgent === agent.value) continue;

		onAttempt?.(agent.label);

		// A retry that throws is a result about that agent, not a reason to
		// abandon the rest of the matrix.
		try {
			const result = await checkPageScrapeability(browser, url, {
				...options,
				userAgent: agent.value,
				// Screenshots are the expensive part and the first attempt already
				// captured one; a retry only needs the verdict.
				screenshotEnabled: false,
			});
			const outcome = summarise(result);
			attempts.push(
				Object.freeze({
					label: agent.label,
					userAgent: agent.value,
					outcome,
					statusCode: result.statusCode,
					error: result.error,
				}),
			);
			if (outcome === 'ok') break;
		} catch (error) {
			attempts.push(
				Object.freeze({
					label: agent.label,
					userAgent: agent.value,
					outcome: 'failed' as const,
					statusCode: null,
					error: error instanceof Error ? error.message : 'Unknown error',
				}),
			);
		}
	}

	return Object.freeze(attempts);
}
