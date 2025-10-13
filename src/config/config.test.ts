/**
 * Tests for configuration management
 */
import { describe, expect, it } from 'vitest';
import type { Config } from '../types';
import { getDefaultConfiguration, validateConfiguration } from './config';

describe('Configuration', () => {
	describe('getDefaultConfiguration', () => {
		it('should return frozen default configuration', () => {
			const config = getDefaultConfiguration();
			expect(config).toBeDefined();
			expect(config.browser.timeout).toBe(30000);
			expect(config.screenshot.enabled).toBe(true);
			expect(Object.isFrozen(config)).toBe(true);
		});

		it('should have valid default values', () => {
			const config = getDefaultConfiguration();
			expect(config.browser.viewport.width).toBeGreaterThan(0);
			expect(config.browser.viewport.height).toBeGreaterThan(0);
			expect(config.screenshot.path).toBeTruthy();
			expect(['all', 'important', 'silent']).toContain(
				config.notificationsLevel,
			);
		});
	});

	describe('validateConfiguration', () => {
		it('should validate correct configuration', () => {
			const config = getDefaultConfiguration();
			const errors = validateConfiguration(config);
			expect(errors).toHaveLength(0);
		});

		it('should reject timeout less than 5000ms', () => {
			const config: Config = {
				...getDefaultConfiguration(),
				browser: {
					...getDefaultConfiguration().browser,
					timeout: 1000,
				},
			};
			const errors = validateConfiguration(config);
			expect(errors.length).toBeGreaterThan(0);
			expect(errors.some((e) => e.includes('timeout'))).toBe(true);
		});

		it('should reject invalid viewport dimensions', () => {
			const config: Config = {
				...getDefaultConfiguration(),
				browser: {
					...getDefaultConfiguration().browser,
					viewport: { width: 100, height: 100 },
				},
			};
			const errors = validateConfiguration(config);
			expect(errors.length).toBeGreaterThan(0);
		});

		it('should reject empty screenshot path', () => {
			const config: Config = {
				...getDefaultConfiguration(),
				screenshot: {
					...getDefaultConfiguration().screenshot,
					path: '',
				},
			};
			const errors = validateConfiguration(config);
			expect(errors.length).toBeGreaterThan(0);
			expect(errors.some((e) => e.includes('path'))).toBe(true);
		});
	});
});
