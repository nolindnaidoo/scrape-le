import * as assert from 'node:assert';
import * as vscode from 'vscode';

const EXTENSION_ID = 'nolindnaidoo.scrape-le';

describe('Scrape-LE integration', function () {
	this.timeout(30_000);

	it('activates', async () => {
		const extension = vscode.extensions.getExtension(EXTENSION_ID);
		assert.ok(extension, `extension ${EXTENSION_ID} not found`);
		await extension.activate();
		assert.strictEqual(extension.isActive, true);
	});

	it('registers every declared command', async () => {
		const extension = vscode.extensions.getExtension(EXTENSION_ID);
		await extension?.activate();
		const commands = await vscode.commands.getCommands(true);
		for (const id of [
			'scrape-le.checkUrl',
			'scrape-le.checkSelection',
			'scrape-le.setup',
			'scrape-le.openSettings',
			'scrape-le.help',
		]) {
			assert.ok(commands.includes(id), `missing command: ${id}`);
		}
	});

	it('help command opens the help document end to end', async () => {
		const extension = vscode.extensions.getExtension(EXTENSION_ID);
		await extension?.activate();

		await vscode.commands.executeCommand('scrape-le.help');

		const helpDoc = vscode.workspace.textDocuments.find(
			(doc) =>
				doc.languageId === 'markdown' &&
				doc.getText().includes('# Scrape-LE Help & Troubleshooting'),
		);
		assert.ok(helpDoc, 'help document not opened');
		// documents only real features
		assert.ok(!helpDoc.getText().includes('Export Results'));
	});

	it('offers its MCP server to agent mode', async () => {
		// The provider is registered against the id the manifest declares; a
		// mismatch leaves the tools invisible with nothing logged. Assert the
		// declaration and the API the floor was raised for, together — the
		// registration itself is only observable in a real host, which
		// scripts/e2e-vsix.js covers against the installed VSIX.
		const extension = vscode.extensions.getExtension(EXTENSION_ID);
		await extension?.activate();

		assert.strictEqual(
			typeof vscode.lm.registerMcpServerDefinitionProvider,
			'function',
			'this VS Code build predates the MCP provider API',
		);

		const providers = extension?.packageJSON.contributes
			.mcpServerDefinitionProviders as { id: string; label: string }[];
		assert.deepStrictEqual(
			providers.map((p) => p.id),
			['scrape-le'],
		);
	});

	it('checkSelection without an editor completes without throwing', async () => {
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		await vscode.commands.executeCommand('scrape-le.checkSelection');
	});

	it('openSettings executes without throwing', async () => {
		await vscode.commands.executeCommand('scrape-le.openSettings');
	});
});
