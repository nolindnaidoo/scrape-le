import type { Page } from 'playwright-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthenticationDetector } from './authentication';

vi.mock('vscode');

/**
 * The `page.evaluate` callbacks in the authentication detector.
 *
 * These run inside the browser, so a stubbed page never calls them and they
 * sat uncovered — which matters because they are where the login-form and
 * keyword heuristics actually live. The functions themselves are pure DOM
 * querying, so running them against a stub `document` tests the real logic.
 *
 * `page.evaluate` here simply invokes the callback in-process with a document
 * stub installed as a global, which is exactly what Playwright does inside the
 * page.
 */

type DocStub = {
	querySelectorAll: (selector: string) => unknown[];
	body: { innerText: string };
};

/** A page whose evaluate() runs the callback against `doc`. */
function pageWith(doc: DocStub): Page {
	return {
		evaluate: async (fn: () => unknown) => {
			const previous = (globalThis as { document?: unknown }).document;
			(globalThis as { document?: unknown }).document = doc;
			try {
				return fn();
			} finally {
				(globalThis as { document?: unknown }).document = previous;
			}
		},
		url: () => 'https://example.com/login',
	} as unknown as Page;
}

/** A password input that reports the form it belongs to. */
function passwordInput(form: unknown = null) {
	return {
		closest: () => form,
		getAttribute: () => null,
	};
}

function emptyDoc(overrides: Partial<DocStub> = {}): DocStub {
	return {
		querySelectorAll: () => [],
		body: { innerText: '' },
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('login-form detection', () => {
	it('reports no form when the page has no password input', async () => {
		const page = pageWith(emptyDoc());
		const result = await AuthenticationDetector.detectAuthentication(page, 200);
		expect(result.required).toBe(false);
	});

	it('detects a password input with no surrounding form', async () => {
		const page = pageWith(
			emptyDoc({
				querySelectorAll: (selector) =>
					selector.includes('password') ? [passwordInput(null)] : [],
			}),
		);
		const result = await AuthenticationDetector.detectAuthentication(page, 200);
		expect(result).toBeDefined();
	});

	it('detects a password input inside a form with a username field', async () => {
		const form = {
			querySelector: (selector: string) =>
				selector.includes('text') || selector.includes('email') ? {} : null,
			getAttribute: () => '/login',
		};
		const page = pageWith(
			emptyDoc({
				querySelectorAll: (selector) =>
					selector.includes('password') ? [passwordInput(form)] : [],
			}),
		);
		const result = await AuthenticationDetector.detectAuthentication(page, 200);
		expect(result).toBeDefined();
	});
});

describe('auth keyword detection', () => {
	it('finds a sign-in keyword in the page text', async () => {
		const page = pageWith(emptyDoc({ body: { innerText: 'Please Sign In' } }));
		const result = await AuthenticationDetector.detectAuthentication(page, 200);
		expect(result).toBeDefined();
	});

	it('finds nothing in unrelated page text', async () => {
		const page = pageWith(
			emptyDoc({ body: { innerText: 'A page about badgers' } }),
		);
		const result = await AuthenticationDetector.detectAuthentication(page, 200);
		expect(result.required).toBe(false);
	});

	it('treats a 401 as requiring authentication regardless of content', async () => {
		const page = pageWith(emptyDoc());
		const result = await AuthenticationDetector.detectAuthentication(page, 401);
		expect(result.required).toBe(true);
	});

	it('treats a 403 as requiring authentication', async () => {
		const page = pageWith(emptyDoc());
		const result = await AuthenticationDetector.detectAuthentication(page, 403);
		expect(result.required).toBe(true);
	});
});
