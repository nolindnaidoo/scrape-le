/**
 * Which browser a render drives: `find_browser` in `crate/src/render.rs`, over
 * `headless_chrome`'s own `default_executable`. The order decides which path
 * `doctor` names, so it is the crate's order exactly.
 */
import { execFileSync } from 'node:child_process';
import { accessSync, constants, existsSync, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';

/** Brave and Edge, which `default_executable` does not look for. */
const CANDIDATES: readonly string[] = Object.freeze([
	'/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
	'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
	'/usr/bin/brave-browser',
	'/usr/bin/microsoft-edge',
	'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
	'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
]);

const ON_PATH: readonly string[] = Object.freeze([
	'google-chrome-stable',
	'google-chrome-beta',
	'google-chrome-dev',
	'google-chrome-unstable',
	'chromium',
	'chromium-browser',
	'microsoft-edge-stable',
	'microsoft-edge-beta',
	'microsoft-edge-dev',
	'chrome',
	'chrome-browser',
	'msedge',
	'microsoft-edge',
]);

const MAC_APPS: readonly string[] = Object.freeze([
	'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
	'/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta',
	'/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev',
	'/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
	'/Applications/Chromium.app/Contents/MacOS/Chromium',
	'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
	'/Applications/Microsoft Edge Beta.app/Contents/MacOS/Microsoft Edge Beta',
	'/Applications/Microsoft Edge Dev.app/Contents/MacOS/Microsoft Edge Dev',
	'/Applications/Microsoft Edge Canary.app/Contents/MacOS/Microsoft Edge Canary',
]);

export type BrowserFound =
	| Readonly<{ ok: true; path: string }>
	| Readonly<{ ok: false; reason: string }>;

export function findBrowser(
	env: NodeJS.ProcessEnv = process.env,
	platform: NodeJS.Platform = process.platform,
): BrowserFound {
	const override = env.CHROME;
	if (override !== undefined) {
		if (existsSync(override)) return { ok: true, path: override };
		return {
			ok: false,
			reason: `CHROME points at ${override}, which does not exist`,
		};
	}
	const found = defaultExecutable(env, platform);
	if (found !== undefined) return { ok: true, path: found };
	const candidate = CANDIDATES.find((path) => existsSync(path));
	if (candidate !== undefined) return { ok: true, path: candidate };
	return {
		ok: false,
		reason:
			'no Chromium-family browser found (Chrome, Chromium, Brave, Edge) — install one or set CHROME to its executable',
	};
}

function defaultExecutable(
	env: NodeJS.ProcessEnv,
	platform: NodeJS.Platform,
): string | undefined {
	for (const name of ON_PATH) {
		const path = which(name, env, platform);
		if (path !== undefined) return path;
	}
	if (platform === 'darwin') {
		const app = MAC_APPS.find((path) => existsSync(path));
		if (app !== undefined) return app;
	}
	if (platform === 'win32') {
		const registered = registryChrome();
		if (registered !== undefined && existsSync(registered)) return registered;
		const edge =
			'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
		if (existsSync(edge)) return edge;
	}
	return undefined;
}

/** The `which` crate: the first executable file named so on `PATH`, uncanonicalized. */
function which(
	name: string,
	env: NodeJS.ProcessEnv,
	platform: NodeJS.Platform,
): string | undefined {
	const directories = (env.PATH ?? env.Path ?? '').split(delimiter);
	const extensions =
		platform === 'win32'
			? (env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
			: [''];
	for (const directory of directories) {
		for (const extension of extensions) {
			const path = join(directory, `${name}${extension}`);
			if (isExecutable(path, platform)) return path;
		}
	}
	return undefined;
}

function isExecutable(path: string, platform: NodeJS.Platform): boolean {
	try {
		if (!statSync(path).isFile()) return false;
		if (platform === 'win32') return true;
		accessSync(path, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

/** `App Paths\chrome.exe`, where Chrome's installer records itself. */
function registryChrome(): string | undefined {
	try {
		const output = execFileSync(
			'reg',
			[
				'query',
				'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe',
				'/ve',
			],
			{
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'ignore'],
				windowsHide: true,
			},
		);
		const line = output
			.split(/\r?\n/)
			.find((text) => /REG_(EXPAND_)?SZ/.test(text));
		const value = line?.replace(/^.*?REG_(?:EXPAND_)?SZ\s+/, '').trim();
		return value === undefined || value === '' ? undefined : value;
	} catch {
		return undefined;
	}
}
