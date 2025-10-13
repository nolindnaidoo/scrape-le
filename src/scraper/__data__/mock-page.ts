/**
 * Mock Playwright page object for testing
 */

export type MockPage = {
	goto: (
		url: string,
		options?: unknown,
	) => Promise<{ status: () => number | null }>;
	title: () => Promise<string>;
	screenshot: (options: { path: string; fullPage: boolean }) => Promise<Buffer>;
	close: () => Promise<void>;
	on: (event: string, handler: (...args: unknown[]) => void) => void;
};

export function createMockPage(overrides?: Partial<MockPage>): MockPage {
	return {
		goto: async (_url: string) => ({
			status: () => 200,
		}),
		title: async () => 'Test Page',
		screenshot: async () => Buffer.from('mock-screenshot'),
		close: async () => {},
		on: () => {},
		...overrides,
	};
}
