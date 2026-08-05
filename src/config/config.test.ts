import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, getConfiguration } from './config';

/**
 * DEFAULT_CONFIG must stay identical to the defaults declared in
 * package.json contributes.configuration, and every declared setting
 * must be covered — settings that exist only in the manifest are dead,
 * settings that exist only in code are invisible to users.
 */
describe('config defaults parity with package.json', () => {
	const manifest = JSON.parse(
		readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8'),
	) as {
		contributes: {
			configuration: { properties: Record<string, { default: unknown }> };
		};
	};
	const props = manifest.contributes.configuration.properties;

	const KEY_MAP: Record<string, unknown> = {
		'scrape-le.browser.timeout': DEFAULT_CONFIG.browser.timeout,
		'scrape-le.browser.viewport.width': DEFAULT_CONFIG.browser.viewport.width,
		'scrape-le.browser.viewport.height': DEFAULT_CONFIG.browser.viewport.height,
		// manifest declares '' — the runtime maps empty to undefined
		'scrape-le.browser.userAgent': '',
		'scrape-le.retry.userAgents': DEFAULT_CONFIG.retry.userAgents,
		'scrape-le.screenshot.enabled': DEFAULT_CONFIG.screenshot.enabled,
		'scrape-le.screenshot.path': DEFAULT_CONFIG.screenshot.path,
		'scrape-le.screenshot.format': DEFAULT_CONFIG.screenshot.format,
		'scrape-le.screenshot.quality': DEFAULT_CONFIG.screenshot.quality,
		'scrape-le.checkConsoleErrors': DEFAULT_CONFIG.checkConsoleErrors,
		'scrape-le.notificationsLevel': DEFAULT_CONFIG.notificationsLevel,
		'scrape-le.statusBar.enabled': DEFAULT_CONFIG.statusBar.enabled,
		'scrape-le.detections.antiBot': DEFAULT_CONFIG.detections.antiBot,
		'scrape-le.detections.rateLimit': DEFAULT_CONFIG.detections.rateLimit,
		'scrape-le.detections.robotsTxt': DEFAULT_CONFIG.detections.robotsTxt,
		'scrape-le.detections.authentication':
			DEFAULT_CONFIG.detections.authentication,
	};

	it('covers every declared setting', () => {
		expect(Object.keys(props).sort()).toEqual(Object.keys(KEY_MAP).sort());
	});

	for (const [manifestKey, defaultValue] of Object.entries(KEY_MAP)) {
		it(`${manifestKey} default matches`, () => {
			expect(defaultValue).toBe(props[manifestKey]?.default);
		});
	}

	it('getConfiguration falls back to DEFAULT_CONFIG when nothing is set', () => {
		// the vscode mock's getConfiguration().get() returns undefined
		expect(getConfiguration()).toEqual(DEFAULT_CONFIG);
	});
});
