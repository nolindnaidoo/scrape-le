/**
 * Output channel management for Scrape-LE
 *
 * Each detection renders through its own function. Written as one nested block
 * this reached six levels — section, detected, field, list — which is where
 * the "None detected" line for one detector ended up guarded by another
 * detector's predicate.
 */
import * as vscode from 'vscode';
import type { CheckResult, UserAgentAttempt } from '../types';

let outputChannel: vscode.OutputChannel | null = null;

/**
 * Gets or creates the output channel
 */
function getOutputChannel(): vscode.OutputChannel {
	if (!outputChannel) {
		outputChannel = vscode.window.createOutputChannel('Scrape-LE');
	}
	return outputChannel;
}

type Detections = NonNullable<CheckResult['detections']>;
type Channel = vscode.OutputChannel;

const FAILURE_LABELS: Readonly<Record<string, string>> = Object.freeze({
	rateLimit: 'Rate Limiting',
	antiBot: 'Anti-Bot',
	robotsTxt: 'robots.txt',
	authentication: 'Authentication',
});

function appendConsoleErrors(
	channel: Channel,
	errors: readonly string[],
): void {
	if (errors.length === 0) {
		channel.appendLine('   Console Errors: None');
		return;
	}

	channel.appendLine(`   Console Errors: ${errors.length}`);
	for (const error of errors) {
		channel.appendLine(`      - ${error}`);
	}
}

function appendRateLimit(channel: Channel, rl: Detections['rateLimit']): void {
	if (!rl) return;
	if (!rl.detected) {
		channel.appendLine('   📊 Rate Limiting: Not detected');
		return;
	}

	channel.appendLine('   📊 Rate Limiting: Detected');
	if (rl.limit) channel.appendLine(`      - Limit: ${rl.limit}`);
	if (rl.remaining) channel.appendLine(`      - Remaining: ${rl.remaining}`);
	if (rl.reset) channel.appendLine(`      - Reset: ${rl.reset}`);
	if (rl.retryAfter) {
		channel.appendLine(`      - Retry After: ${rl.retryAfter}`);
	}
}

function appendAntiBot(channel: Channel, ab: Detections['antiBot']): void {
	if (!ab) return;

	const vendors: ReadonlyArray<readonly [boolean, string]> = [
		[ab.cloudflare, 'Cloudflare'],
		[ab.recaptcha, 'reCAPTCHA'],
		[ab.hcaptcha, 'hCaptcha'],
		[ab.datadome, 'DataDome'],
		[ab.perimeterx, 'PerimeterX'],
	];
	const present = vendors.filter(([found]) => found);

	if (present.length === 0) {
		channel.appendLine('   🤖 Anti-Bot Measures: None detected');
		return;
	}

	channel.appendLine('   🤖 Anti-Bot Measures: Detected');
	for (const [, name] of present) {
		channel.appendLine(`      - ${name}: Yes`);
	}
	if (ab.details.length === 0) return;

	channel.appendLine('      Details:');
	for (const detail of ab.details) {
		channel.appendLine(`        • ${detail}`);
	}
}

function appendDisallowedPaths(
	channel: Channel,
	paths: readonly string[],
): void {
	if (paths.length === 0) return;

	channel.appendLine('      - Disallowed Paths:');
	for (const path of paths.slice(0, 5)) {
		channel.appendLine(`        • ${path}`);
	}
	if (paths.length > 5) {
		channel.appendLine(`        • ... and ${paths.length - 5} more`);
	}
}

function appendRobotsTxt(channel: Channel, rt: Detections['robotsTxt']): void {
	if (!rt) return;
	if (!rt.exists) {
		channel.appendLine('   🤖 robots.txt: Not found');
		return;
	}

	channel.appendLine('   🤖 robots.txt: Found');
	channel.appendLine(
		`      - Allows Crawling: ${rt.allowsCrawling ? 'Yes' : 'No'}`,
	);
	if (rt.crawlDelay) {
		channel.appendLine(`      - Crawl Delay: ${rt.crawlDelay}s`);
	}
	appendDisallowedPaths(channel, rt.disallowedPaths);
	for (const sitemap of rt.sitemaps) {
		channel.appendLine(`      - Sitemap: ${sitemap}`);
	}
}

function appendAuthentication(
	channel: Channel,
	auth: Detections['authentication'],
): void {
	if (!auth) return;
	if (!auth.required) {
		channel.appendLine('   🔐 Authentication: Not required');
		return;
	}

	channel.appendLine('   🔐 Authentication: Required');
	if (auth.type) channel.appendLine(`      - Type: ${auth.type}`);
	if (auth.loginUrl) channel.appendLine(`      - Login URL: ${auth.loginUrl}`);
	if (auth.indicators.length === 0) return;

	channel.appendLine('      - Indicators:');
	for (const indicator of auth.indicators) {
		channel.appendLine(`        • ${indicator}`);
	}
}

const ATTEMPT_MARK: Readonly<Record<UserAgentAttempt['outcome'], string>> =
	Object.freeze({
		ok: '✅',
		'bot-detected': '🤖',
		failed: '❌',
	});

/**
 * What each User-Agent produced, and the one to configure.
 *
 * The first attempt already reported why the page resisted; this says what
 * would have worked, which is the part a user can act on.
 */
function appendUserAgentAttempts(
	channel: Channel,
	attempts: readonly UserAgentAttempt[],
): void {
	if (attempts.length === 0) return;

	channel.appendLine('');
	channel.appendLine('🔁 USER-AGENT RETRIES:');
	for (const a of attempts) {
		const detail = a.error ? ` — ${a.error}` : ` — HTTP ${a.statusCode ?? '?'}`;
		channel.appendLine(`   ${ATTEMPT_MARK[a.outcome]} ${a.label}${detail}`);
	}

	const worked = attempts.find((a) => a.outcome === 'ok');
	channel.appendLine('');
	if (!worked) {
		channel.appendLine(
			'   None of the tried agents loaded the page cleanly. The block is not',
		);
		channel.appendLine(
			'   User-Agent based — check the detections above for the mechanism.',
		);
		return;
	}
	channel.appendLine(
		`   ${worked.label} loaded the page cleanly. To use it, set`,
	);
	channel.appendLine('   scrape-le.browser.userAgent to:');
	channel.appendLine(`      ${worked.userAgent}`);
}

/**
 * A detector that threw leaves its field absent, and every block above skips
 * absent fields — so without this the check silently reports nothing at all
 * for that detection and reads as if it had passed.
 */
function appendFailures(
	channel: Channel,
	failures: Detections['failures'],
): void {
	if (!failures) return;

	for (const failure of failures) {
		const label = FAILURE_LABELS[failure.detection] ?? failure.detection;
		channel.appendLine(`   ⚠️ ${label}: check failed — ${failure.message}`);
	}
}

function appendDetections(channel: Channel, detections: Detections): void {
	channel.appendLine('');
	channel.appendLine('🔍 DETECTIONS:');
	appendRateLimit(channel, detections.rateLimit);
	appendAntiBot(channel, detections.antiBot);
	appendRobotsTxt(channel, detections.robotsTxt);
	appendAuthentication(channel, detections.authentication);
	appendFailures(channel, detections.failures);
}

function appendFailure(channel: Channel, result: CheckResult): void {
	channel.appendLine(`❌ FAILED: ${result.url}`);
	if (result.error) {
		channel.appendLine(`   Error: ${result.error}`);
	}
	channel.appendLine(`   Load Time: ${result.loadTimeMs}ms`);
	if (result.userAgentAttempts) {
		appendUserAgentAttempts(channel, result.userAgentAttempts);
	}
}

function appendSuccess(channel: Channel, result: CheckResult): void {
	channel.appendLine(`✅ SUCCESS: ${result.url}`);
	channel.appendLine(`   Status Code: ${result.statusCode}`);
	channel.appendLine(`   Title: ${result.title}`);
	channel.appendLine(`   Load Time: ${result.loadTimeMs}ms`);
	if (result.screenshotPath) {
		channel.appendLine(`   Screenshot: ${result.screenshotPath}`);
	}
	appendConsoleErrors(channel, result.consoleErrors);
	if (result.detections) {
		appendDetections(channel, result.detections);
	}
	if (result.userAgentAttempts) {
		appendUserAgentAttempts(channel, result.userAgentAttempts);
	}
}

/**
 * Logs a check result to the output channel
 */
export function logCheckResult(result: CheckResult): void {
	const channel = getOutputChannel();
	channel.appendLine('');
	channel.appendLine('='.repeat(80));

	if (result.success) {
		appendSuccess(channel, result);
	}
	if (!result.success) {
		appendFailure(channel, result);
	}

	channel.appendLine('='.repeat(80));
	channel.appendLine('');
}

/**
 * Shows the output channel
 */
export function showOutput(): void {
	const channel = getOutputChannel();
	channel.show(true);
}
