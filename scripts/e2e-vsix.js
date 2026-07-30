#!/usr/bin/env node
/**
 * Installed-VSIX end-to-end test: installs release/<name>-<version>.vsix
 * into a CLEAN VS Code profile (fresh extensions + user-data dirs) and
 * drives it as a real installed extension — the exact artifact users
 * get, not the dev folder.
 *
 * Usage: npm run package && node scripts/e2e-vsix.js
 *
 * Activation alone is the headline probe here: every v1.x VSIX failed
 * at require('vscode-nls')/require('playwright-core') on activation.
 * Activating the installed artifact proves the bundle is self-contained
 * and playwright-core resolves from inside the VSIX.
 *
 * Note: the profile dirs must be SHORT paths — macOS caps the
 * user-data-dir socket path (~103 chars); deep temp dirs fail with a
 * cryptic `claimInstance` error at startup.
 */
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
	downloadAndUnzipVSCode,
	resolveCliArgsFromVSCodeExecutablePath,
	runTests,
} = require('@vscode/test-electron');

const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const extensionId = `${manifest.publisher}.${manifest.name}`;
const vsixPath = path.resolve(
	'release',
	`${manifest.name}-${manifest.version}.vsix`,
);

if (!fs.existsSync(vsixPath)) {
	console.error(`FAIL: ${vsixPath} not found — run \`npm run package\` first`);
	process.exit(1);
}

const profileRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vsix-e2e-'));
const extensionsDir = path.join(profileRoot, 'ext');
const userDataDir = path.join(profileRoot, 'usr');

// Probe extension: a no-op dev extension whose test suite exercises the
// INSTALLED extension under test.
const probeDir = path.join(profileRoot, 'probe');
fs.mkdirSync(probeDir, { recursive: true });
fs.writeFileSync(
	path.join(probeDir, 'package.json'),
	JSON.stringify({
		name: 'vsix-e2e-probe',
		publisher: 'local',
		version: '0.0.1',
		engines: { vscode: manifest.engines.vscode },
		main: './extension.js',
	}),
);
fs.writeFileSync(
	path.join(probeDir, 'extension.js'),
	'module.exports = { activate() {}, deactivate() {} };\n',
);
fs.writeFileSync(
	path.join(probeDir, 'suite.js'),
	`const vscode = require('vscode');
const assert = require('assert');
exports.run = async function run() {
	const ext = vscode.extensions.getExtension(${JSON.stringify(extensionId)});
	assert.ok(ext, 'installed ${extensionId} not found');
	await ext.activate();
	assert.strictEqual(ext.isActive, true, 'extension failed to activate');

	// Every declared command must be registered by the installed artifact.
	const commands = await vscode.commands.getCommands(true);
	for (const id of [
		'scrape-le.checkUrl',
		'scrape-le.checkSelection',
		'scrape-le.setup',
		'scrape-le.openSettings',
		'scrape-le.help',
	]) {
		assert.ok(commands.includes(id), 'missing command: ' + id);
	}

	// Smoke a full command flow that needs no user input or network:
	// help must open its markdown document with honest content.
	await vscode.commands.executeCommand('scrape-le.help');
	const helpDoc = vscode.workspace.textDocuments.find(
		(d) =>
			d.languageId === 'markdown' &&
			d.getText().includes('# Scrape-LE Help & Troubleshooting'),
	);
	assert.ok(helpDoc, 'help document not opened');
	assert.ok(!helpDoc.getText().includes('Export Results'), 'phantom feature in help');

	// Guard against hangs: commands that bail early must return.
	await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	await vscode.commands.executeCommand('scrape-le.checkSelection');
	await vscode.commands.executeCommand('scrape-le.openSettings');

	console.log('VSIX E2E OK: activation + commands + help flow');
};
`,
);

(async () => {
	const vscodeExecutablePath = await downloadAndUnzipVSCode('stable');
	const [cli, ...args] =
		resolveCliArgsFromVSCodeExecutablePath(vscodeExecutablePath);

	cp.execFileSync(
		cli,
		[
			...args,
			'--extensions-dir',
			extensionsDir,
			'--user-data-dir',
			userDataDir,
			'--install-extension',
			vsixPath,
		],
		{ stdio: 'inherit' },
	);

	await runTests({
		vscodeExecutablePath,
		extensionDevelopmentPath: probeDir,
		extensionTestsPath: path.join(probeDir, 'suite.js'),
		launchArgs: [
			'--extensions-dir',
			extensionsDir,
			'--user-data-dir',
			userDataDir,
		],
	});
	console.log(`INSTALLED-VSIX TEST: PASS (${path.basename(vsixPath)})`);
})()
	.catch((error) => {
		console.error('INSTALLED-VSIX TEST: FAIL', error);
		process.exitCode = 1;
	})
	.finally(() => {
		fs.rmSync(profileRoot, { recursive: true, force: true });
	});
