import { beforeEach, describe, expect, it } from 'vitest';
import {
	_createExtensionContext,
	_mcpProviders,
	_resetMockState,
	_setLmApi,
	_shownMessages,
	type McpStdioServerDefinition,
} from '../__mocks__/vscode';
import { registerMcpProvider } from './provider';

/**
 * The provider, on a host with agent mode and on one without. Nothing drove
 * either path before: the mock had no `lm`, so every activation in the unit
 * suite took the "absent" branch without a test saying so.
 */
describe('the MCP provider', () => {
	beforeEach(() => {
		_resetMockState();
	});

	it('offers the bundled server, spawned as Node, carrying the extension version', () => {
		const context = _createExtensionContext();
		const disposable = registerMcpProvider(context as never);

		expect(disposable).toBeDefined();
		expect(context.subscriptions).toContain(disposable);
		const [entry] = _mcpProviders();
		expect(entry?.id).toBe('scrape-le');
		const provider = entry?.provider as {
			provideMcpServerDefinitions: () => McpStdioServerDefinition[];
		};
		const definitions = provider.provideMcpServerDefinitions();
		expect(definitions).toHaveLength(1);
		const [definition] = definitions;
		// The extension host is Electron: without this the definition starts a
		// second editor and the failure is silent.
		expect(definition?.command).toBe(process.execPath);
		expect(definition?.env).toEqual({ ELECTRON_RUN_AS_NODE: '1' });
		expect(definition?.args).toEqual(['/ext/dist/mcp-server.js']);
		expect(definition?.version).toBe('0.0.0-test');
	});

	it('says nothing on a host without the API', () => {
		_setLmApi(false);
		const context = _createExtensionContext();

		expect(registerMcpProvider(context as never)).toBeUndefined();
		expect(context.subscriptions).toHaveLength(0);
		expect(_mcpProviders()).toHaveLength(0);
		expect(_shownMessages()).toHaveLength(0);
	});
});
