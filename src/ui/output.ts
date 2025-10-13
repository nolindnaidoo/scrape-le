/**
 * Output channel management for Scrape-LE
 */
import * as vscode from 'vscode';
import type { CheckResult } from '../types';

let outputChannel: vscode.OutputChannel | null = null;

/**
 * Gets or creates the output channel
 */
export function getOutputChannel(): vscode.OutputChannel {
	if (!outputChannel) {
		outputChannel = vscode.window.createOutputChannel('Scrape-LE');
	}
	return outputChannel;
}

/**
 * Logs a message to the output channel
 */
export function log(message: string): void {
	const channel = getOutputChannel();
	const timestamp = new Date().toISOString();
	channel.appendLine(`[${timestamp}] ${message}`);
}

/**
 * Logs a check result to the output channel
 */
export function logCheckResult(result: CheckResult): void {
	const channel = getOutputChannel();
	channel.appendLine('');
	channel.appendLine('='.repeat(80));

	if (result.success) {
		channel.appendLine(`✅ SUCCESS: ${result.url}`);
		channel.appendLine(`   Status Code: ${result.statusCode}`);
		channel.appendLine(`   Title: ${result.title}`);
		channel.appendLine(`   Load Time: ${result.loadTimeMs}ms`);

		if (result.screenshotPath) {
			channel.appendLine(`   Screenshot: ${result.screenshotPath}`);
		}

		if (result.consoleErrors.length > 0) {
			channel.appendLine(`   Console Errors: ${result.consoleErrors.length}`);
			for (const error of result.consoleErrors) {
				channel.appendLine(`      - ${error}`);
			}
		} else {
			channel.appendLine('   Console Errors: None');
		}

		// Display detection results if available
		if (result.detections) {
			channel.appendLine('');
			channel.appendLine('🔍 DETECTIONS:');

			// Rate Limit Detection
			if (result.detections.rateLimit) {
				const rl = result.detections.rateLimit;
				if (rl.detected) {
					channel.appendLine('   📊 Rate Limiting: Detected');
					if (rl.limit) {
						channel.appendLine(`      - Limit: ${rl.limit}`);
					}
					if (rl.remaining) {
						channel.appendLine(`      - Remaining: ${rl.remaining}`);
					}
					if (rl.reset) {
						channel.appendLine(`      - Reset: ${rl.reset}`);
					}
					if (rl.retryAfter) {
						channel.appendLine(`      - Retry After: ${rl.retryAfter}`);
					}
				} else {
					channel.appendLine('   📊 Rate Limiting: Not detected');
				}
			}

			// Anti-Bot Detection
			if (result.detections.antiBot) {
				const ab = result.detections.antiBot;
				const detected =
					ab.cloudflare ||
					ab.recaptcha ||
					ab.hcaptcha ||
					ab.datadome ||
					ab.perimeter81;

				if (detected) {
					channel.appendLine('   🤖 Anti-Bot Measures: Detected');
					if (ab.cloudflare) {
						channel.appendLine('      - Cloudflare: Yes');
					}
					if (ab.recaptcha) {
						channel.appendLine('      - reCAPTCHA: Yes');
					}
					if (ab.hcaptcha) {
						channel.appendLine('      - hCaptcha: Yes');
					}
					if (ab.datadome) {
						channel.appendLine('      - DataDome: Yes');
					}
					if (ab.perimeter81) {
						channel.appendLine('      - Perimeter81: Yes');
					}
					if (ab.details.length > 0) {
						channel.appendLine('      Details:');
						for (const detail of ab.details) {
							channel.appendLine(`        • ${detail}`);
						}
					}
				} else {
					channel.appendLine('   🤖 Anti-Bot Measures: None detected');
				}
			}

			// robots.txt Detection
			if (result.detections.robotsTxt) {
				const rt = result.detections.robotsTxt;
				if (rt.exists) {
					channel.appendLine('   🤖 robots.txt: Found');
					channel.appendLine(
						`      - Allows Crawling: ${rt.allowsCrawling ? 'Yes' : 'No'}`,
					);
					if (rt.crawlDelay) {
						channel.appendLine(`      - Crawl Delay: ${rt.crawlDelay}s`);
					}
					if (rt.disallowedPaths.length > 0) {
						channel.appendLine('      - Disallowed Paths:');
						for (const path of rt.disallowedPaths.slice(0, 5)) {
							channel.appendLine(`        • ${path}`);
						}
						if (rt.disallowedPaths.length > 5) {
							channel.appendLine(
								`        • ... and ${rt.disallowedPaths.length - 5} more`,
							);
						}
					}
					if (rt.sitemap) {
						channel.appendLine(`      - Sitemap: ${rt.sitemap}`);
					}
				} else {
					channel.appendLine('   🤖 robots.txt: Not found');
				}
			}

			// Authentication Detection
			if (result.detections.authentication) {
				const auth = result.detections.authentication;
				if (auth.required) {
					channel.appendLine('   🔐 Authentication: Required');
					if (auth.type) {
						channel.appendLine(`      - Type: ${auth.type}`);
					}
					if (auth.loginUrl) {
						channel.appendLine(`      - Login URL: ${auth.loginUrl}`);
					}
					if (auth.indicators.length > 0) {
						channel.appendLine('      - Indicators:');
						for (const indicator of auth.indicators) {
							channel.appendLine(`        • ${indicator}`);
						}
					}
				} else {
					channel.appendLine('   🔐 Authentication: Not required');
				}
			}
		}
	} else {
		channel.appendLine(`❌ FAILED: ${result.url}`);
		if (result.error) {
			channel.appendLine(`   Error: ${result.error}`);
		}
		channel.appendLine(`   Load Time: ${result.loadTimeMs}ms`);
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

/**
 * Clears the output channel
 */
export function clearOutput(): void {
	const channel = getOutputChannel();
	channel.clear();
}

export const Output = Object.freeze({
	getOutputChannel,
	log,
	logCheckResult,
	showOutput,
	clearOutput,
});
