/**
 * Authentication requirement detection
 */

import type { Page } from 'playwright-core';
import type { AuthenticationInfo } from '../types';

/**
 * Detects if page requires authentication
 */
export async function detectAuthentication(
	page: Page,
	statusCode: number | null,
): Promise<AuthenticationInfo> {
	try {
		const indicators: string[] = [];

		// Check HTTP status codes
		const hasAuthStatus = checkAuthStatusCode(statusCode, indicators);

		// Check for login forms
		const loginForm = await detectLoginForm(page, indicators);

		// Check for auth keywords in content
		const hasAuthKeywords = await detectAuthKeywords(page, indicators);

		// Check URL for auth indicators
		const hasUrlIndicator = await checkUrlForAuth(page, indicators);

		// Require at least 2 indicators for high confidence
		// Or 1 strong indicator (401/403 status or login form)
		const isRequired =
			hasAuthStatus ||
			loginForm.detected ||
			(indicators.length >= 2 && (hasAuthKeywords || hasUrlIndicator));

		if (!isRequired) {
			return createDefaultAuthInfo();
		}

		return Object.freeze({
			required: true,
			type: loginForm.type,
			loginUrl: loginForm.loginUrl,
			indicators: Object.freeze(indicators),
		});
	} catch (error) {
		console.error('Error detecting authentication:', error);
		return createDefaultAuthInfo();
	}
}

/**
 * Checks if status code indicates authentication requirement
 */
function checkAuthStatusCode(
	statusCode: number | null,
	indicators: string[],
): boolean {
	if (statusCode === 401) {
		indicators.push('HTTP 401 Unauthorized');
		return true;
	}

	if (statusCode === 403) {
		indicators.push('HTTP 403 Forbidden');
		return true;
	}

	return false;
}

/**
 * Detects login forms on the page
 */
async function detectLoginForm(
	page: Page,
	indicators: string[],
): Promise<{
	detected: boolean;
	type?: AuthenticationInfo['type'];
	loginUrl?: string;
}> {
	try {
		const formInfo = await page.evaluate(() => {
			// Look for password inputs
			const passwordInputs = document.querySelectorAll(
				'input[type="password"]',
			);
			if (passwordInputs.length === 0) {
				return { hasPasswordInput: false };
			}

			// Check if password input is in a form
			const passwordInput = passwordInputs[0];
			const form = passwordInput?.closest('form');

			if (form) {
				// Check for username/email input
				const hasUsernameInput =
					form.querySelector('input[type="text"]') !== null ||
					form.querySelector('input[type="email"]') !== null ||
					form.querySelector('input[name*="user"]') !== null ||
					form.querySelector('input[name*="email"]') !== null;

				return {
					hasPasswordInput: true,
					hasForm: true,
					hasUsernameInput,
					action: form.action,
				};
			}

			return { hasPasswordInput: true, hasForm: false };
		});

		if (formInfo.hasPasswordInput && formInfo.hasForm) {
			indicators.push('Login form detected (username + password fields)');
			const result: {
				detected: true;
				type: 'form';
				loginUrl?: string;
			} = {
				detected: true,
				type: 'form',
			};
			if (formInfo.action) {
				result.loginUrl = formInfo.action;
			}
			return result;
		}

		if (formInfo.hasPasswordInput) {
			indicators.push('Password input detected');
			return { detected: true, type: 'form' };
		}
	} catch (error) {
		console.error('Error detecting login form:', error);
	}

	return { detected: false };
}

/**
 * Detects authentication-related keywords in page content
 */
async function detectAuthKeywords(
	page: Page,
	indicators: string[],
): Promise<boolean> {
	try {
		const hasKeywords = await page.evaluate(() => {
			const text = document.body.innerText.toLowerCase();
			const keywords = [
				'sign in',
				'log in',
				'login required',
				'please log in',
				'authentication required',
				'access denied',
				'unauthorized access',
				'members only',
				'please sign in',
			];

			for (const keyword of keywords) {
				if (text.includes(keyword)) {
					return { found: true, keyword };
				}
			}

			return { found: false };
		});

		if (hasKeywords.found) {
			indicators.push(`Authentication keyword: "${hasKeywords.keyword}"`);
			return true;
		}
	} catch (error) {
		console.error('Error detecting auth keywords:', error);
	}

	return false;
}

/**
 * Checks URL for authentication indicators. Matches whole path
 * segments, not substrings — '/author/jane' must not match 'auth'.
 */
async function checkUrlForAuth(
	page: Page,
	indicators: string[],
): Promise<boolean> {
	try {
		const authSegments = ['login', 'signin', 'sign-in', 'auth', 'authenticate'];
		const pathname = new URL(page.url()).pathname.toLowerCase();
		const segments = pathname.split('/').filter((s) => s.length > 0);

		for (const segment of segments) {
			if (authSegments.includes(segment)) {
				indicators.push(`URL contains auth path segment: /${segment}`);
				return true;
			}
		}
	} catch (error) {
		console.error('Error checking URL for auth:', error);
	}

	return false;
}

/**
 * Creates default auth info (not required)
 */
function createDefaultAuthInfo(): AuthenticationInfo {
	return Object.freeze({
		required: false,
		indicators: Object.freeze([]),
	});
}

export const AuthenticationDetector = Object.freeze({
	detectAuthentication,
});
