#!/usr/bin/env node
/**
 * Bundle gate: the packaged VSIX ships dist/extension.js plus exactly one
 * unbundled runtime dependency (playwright-core, which cannot be bundled:
 * it has optional chromium-bidi requires and require.resolve asset paths
 * that break inside a bundle). Everything else must be self-contained.
 *
 * Three checks:
 * 1. Static: no literal require() of anything but 'vscode', Node builtins,
 *    and 'playwright-core'.
 * 2. Runtime: actually load the bundle with 'vscode' stubbed. This catches
 *    requires the static scan cannot see — e.g. a UMD wrapper passing
 *    `require` through a factory parameter.
 * 3. Packaging: .vscodeignore must allow-list node_modules/playwright-core
 *    or the shipped extension cannot resolve it.
 */
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const ALLOWED_EXTERNALS = new Set(['playwright-core']);

const bundlePath = path.resolve('dist/extension.js');
const source = fs.readFileSync(bundlePath, 'utf8');

// --- 1. static scan -------------------------------------------------
const offenders = new Set();
for (const match of source.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)) {
	const specifier = match[1];
	if (specifier === 'vscode') continue;
	if (Module.isBuiltin(specifier)) continue;
	if (ALLOWED_EXTERNALS.has(specifier)) continue;
	offenders.add(specifier);
}
if (offenders.size > 0) {
	console.error(
		`FAIL (static): ${bundlePath} requires unbundled modules: ${[...offenders].join(', ')}`,
	);
	process.exit(1);
}

// --- 2. runtime load with vscode stubbed ----------------------------
const noop = () => undefined;
const disposable = { dispose: noop };
const vscodeStub = new Proxy(
	{},
	{
		get: (_target, prop) => {
			if (prop === 'workspace') {
				return new Proxy(
					{},
					{
						get: (_t, p) => {
							if (p === 'onDidChangeConfiguration') return () => disposable;
							if (p === 'getConfiguration')
								return () => ({ get: (_k, d) => d, update: async () => {} });
							return noop;
						},
					},
				);
			}
			if (prop === 'window') {
				return new Proxy(
					{},
					{
						get: (_t, p) => {
							if (p === 'createStatusBarItem')
								return () => ({
									show: noop,
									hide: noop,
									dispose: noop,
									text: '',
								});
							if (p === 'createOutputChannel')
								return () => ({ appendLine: noop, dispose: noop });
							return noop;
						},
					},
				);
			}
			if (prop === 'commands')
				return { registerCommand: () => disposable, executeCommand: noop };
			return new Proxy(noop, { get: () => noop });
		},
	},
);

const originalLoad = Module._load;
Module._load = function patchedLoad(request, ...rest) {
	if (request === 'vscode') return vscodeStub;
	return originalLoad.call(this, request, ...rest);
};

try {
	const extension = require(bundlePath);
	if (typeof extension.activate !== 'function') {
		console.error('FAIL (runtime): bundle exports no activate()');
		process.exit(1);
	}
} catch (error) {
	console.error(`FAIL (runtime): bundle failed to load: ${error.message}`);
	process.exit(1);
} finally {
	Module._load = originalLoad;
}

// --- 3. allowed externals must be shipped in the VSIX ----------------
const vscodeignore = fs.readFileSync(path.resolve('.vscodeignore'), 'utf8');
for (const external of ALLOWED_EXTERNALS) {
	if (!vscodeignore.includes(`!node_modules/${external}/`)) {
		console.error(
			`FAIL (packaging): .vscodeignore does not allow-list node_modules/${external} — the shipped extension could not require it`,
		);
		process.exit(1);
	}
}

console.log(
	`OK: ${path.relative(process.cwd(), bundlePath)} is self-contained except [${[...ALLOWED_EXTERNALS].join(', ')}] (static scan + runtime load + packaging check).`,
);
