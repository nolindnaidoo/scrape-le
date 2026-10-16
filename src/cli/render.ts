/**
 * One rendered page: `crate/src/render.rs`, which drives Chrome through
 * `headless_chrome`. Chrome is launched with that crate's flags, the page is
 * loaded once, and the document's own response supplies the status and
 * headers, so a rendered check never asks the site twice.
 *
 * The protocol travels over `--remote-debugging-pipe` instead of a port. That
 * needs no WebSocket and no free port, and changes nothing a page can see.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import type { AuthPageEvidence, ProbeResult, RenderEvidence } from './report';
import type { Signature } from './signatures';

/** Chrome refuses a capture past its maximum texture size. */
const MAX_CAPTURE_PX = 16_384;
const NAVIGATION_TIMEOUT_MS = 20_000;

/** `headless_chrome`'s `DEFAULT_ARGS`, in its order. */
const DEFAULT_ARGS: readonly string[] = Object.freeze([
	'--disable-background-networking',
	'--enable-features=NetworkService,NetworkServiceInProcess',
	'--disable-background-timer-throttling',
	'--disable-backgrounding-occluded-windows',
	'--disable-breakpad',
	'--disable-client-side-phishing-detection',
	'--disable-component-extensions-with-background-pages',
	'--disable-default-apps',
	'--disable-dev-shm-usage',
	'--disable-extensions',
	'--disable-features=TranslateUI,BlinkGenPropertyTrees',
	'--disable-hang-monitor',
	'--disable-ipc-flooding-protection',
	'--disable-popup-blocking',
	'--disable-prompt-on-repost',
	'--disable-renderer-backgrounding',
	'--disable-sync',
	'--force-color-profile=srgb',
	'--metrics-recording-only',
	'--no-first-run',
	'--enable-automation',
	'--password-store=basic',
	'--use-mock-keychain',
]);

type CdpEvent = Readonly<{
	method: string;
	params: Record<string, unknown>;
	sessionId?: string;
}>;

type Cdp = Readonly<{
	send: (
		method: string,
		params?: Record<string, unknown>,
		sessionId?: string,
	) => Promise<Record<string, unknown>>;
	onEvent: (listener: (event: CdpEvent) => void) => void;
}>;

function pipeTransport(writer: Writable, reader: Readable): Cdp {
	let nextId = 1;
	const pending = new Map<
		number,
		{
			resolve: (value: Record<string, unknown>) => void;
			reject: (error: Error) => void;
		}
	>();
	const listeners: ((event: CdpEvent) => void)[] = [];
	let buffer = Buffer.alloc(0);

	reader.on('data', (chunk: Buffer) => {
		buffer = Buffer.concat([buffer, chunk]);
		let end = buffer.indexOf(0);
		while (end !== -1) {
			const message = JSON.parse(buffer.subarray(0, end).toString('utf8')) as {
				id?: number;
				result?: Record<string, unknown>;
				error?: { code: number; message: string };
				method?: string;
				params?: Record<string, unknown>;
				sessionId?: string;
			};
			buffer = buffer.subarray(end + 1);
			end = buffer.indexOf(0);
			if (message.id !== undefined) {
				const waiting = pending.get(message.id);
				pending.delete(message.id);
				if (!waiting) continue;
				if (message.error) {
					waiting.reject(
						new Error(
							`Method call error ${message.error.code}: ${message.error.message}`,
						),
					);
					continue;
				}
				waiting.resolve(message.result ?? {});
				continue;
			}
			if (message.method === undefined) continue;
			const event: CdpEvent = {
				method: message.method,
				params: message.params ?? {},
				...(message.sessionId === undefined
					? {}
					: { sessionId: message.sessionId }),
			};
			for (const listener of listeners) listener(event);
		}
	});
	const closed = (): void => {
		for (const waiting of pending.values()) {
			waiting.reject(
				new Error(
					'Unable to make method calls because underlying connection is closed',
				),
			);
		}
		pending.clear();
	};
	reader.on('close', closed);
	reader.on('error', closed);

	return Object.freeze({
		send: (method, params = {}, sessionId) =>
			new Promise((resolve, reject) => {
				const id = nextId;
				nextId += 1;
				pending.set(id, { resolve, reject });
				const message = {
					id,
					method,
					params,
					...(sessionId ? { sessionId } : {}),
				};
				writer.write(`${JSON.stringify(message)}\0`);
			}),
		onEvent: (listener) => {
			listeners.push(listener);
		},
	});
}

function launch(browserPath: string): {
	child: ChildProcess;
	cdp: Cdp;
	profile: string;
} {
	const profile = mkdtempSync(join(tmpdir(), 'rust-headless-chrome-profile'));
	const args = [
		'--remote-debugging-pipe',
		'--verbose',
		'--log-level=0',
		'--no-first-run',
		`--user-data-dir=${profile}`,
		...DEFAULT_ARGS,
		'--window-size=1280,800',
		'--headless',
		'--disable-gpu',
	];
	const child = spawn(browserPath, args, {
		stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'],
		windowsHide: true,
	});
	const cdp = pipeTransport(
		child.stdio[3] as Writable,
		child.stdio[4] as Readable,
	);
	return { child, cdp, profile };
}

/** Kills the browser and removes the throwaway profile it was given. */
async function shutdown(child: ChildProcess, profile: string): Promise<void> {
	if (child.exitCode === null && child.signalCode === null) {
		const exited = new Promise((resolve) => child.once('exit', resolve));
		child.kill('SIGKILL');
		await exited;
	}
	try {
		// The profile directory is this process's own mkdtemp, never a path
		// anyone passed in.
		rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
	} catch {
		// A profile left in the temp directory costs disk, not correctness.
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function render(
	url: string,
	browserPath: string,
	signatures: readonly Signature[],
): Promise<RenderEvidence> {
	const started = Date.now();
	const { child, cdp, profile } = launch(browserPath);
	const failedToStart = new Promise<never>((_, reject) => {
		child.once('error', (error) => reject(error));
	});
	try {
		return await Promise.race([
			session(cdp, url, signatures, started),
			failedToStart,
		]);
	} finally {
		await shutdown(child, profile);
	}
}

async function session(
	cdp: Cdp,
	url: string,
	signatures: readonly Signature[],
	started: number,
): Promise<RenderEvidence> {
	let targetId = '';
	let targetUrl = 'about:blank';
	let sessionId = '';
	let navigating = false;
	let document:
		| { url: string; status: number; headers: Map<string, string> }
		| undefined;
	const consoleErrors: string[] = [];
	const responses = new Map<string, Record<string, unknown>>();

	cdp.onEvent((event) => {
		if (event.method === 'Target.targetInfoChanged') {
			const info = event.params.targetInfo as {
				targetId?: string;
				url?: string;
			};
			if (info.targetId === targetId && typeof info.url === 'string') {
				targetUrl = info.url;
			}
			return;
		}
		if (event.sessionId !== sessionId) return;
		if (event.method === 'Page.lifecycleEvent') {
			if (event.params.name === 'networkAlmostIdle') navigating = false;
			if (event.params.name === 'init') navigating = true;
			return;
		}
		if (event.method === 'Log.entryAdded') {
			const entry = event.params.entry as { level?: string; text?: string };
			if (entry.level === 'error' || entry.level === 'warning') {
				consoleErrors.push(entry.text ?? '');
			}
			return;
		}
		if (event.method === 'Network.responseReceived') {
			responses.set(String(event.params.requestId), event.params);
			return;
		}
		if (event.method === 'Network.loadingFinished') {
			// A redirect chain answers once per hop; the last document to
			// finish is the page that actually answered.
			const params = responses.get(String(event.params.requestId));
			if (params?.type !== 'Document') return;
			const response = params.response as {
				url: string;
				status: number;
				headers: Record<string, unknown>;
			};
			const headers = new Map<string, string>();
			for (const [name, value] of Object.entries(response.headers ?? {})) {
				if (typeof value === 'string') headers.set(name.toLowerCase(), value);
			}
			document = {
				url: response.url,
				status:
					response.status >= 0 && response.status <= 0xffff
						? response.status
						: 0,
				headers,
			};
		}
	});

	await cdp.send('Target.setDiscoverTargets', { discover: true });
	targetId = String(
		(await cdp.send('Target.createTarget', { url: 'about:blank' })).targetId,
	);
	sessionId = String(
		(await cdp.send('Target.attachToTarget', { targetId, flatten: true }))
			.sessionId,
	);
	const send = (method: string, params: Record<string, unknown> = {}) =>
		cdp.send(method, params, sessionId);
	const evaluate = async (expression: string): Promise<unknown> => {
		const result = await send('Runtime.evaluate', {
			expression,
			returnByValue: false,
			generatePreview: true,
			silent: false,
			awaitPromise: false,
			includeCommandLineAPI: false,
			userGesture: false,
		});
		return (result.result as { value?: unknown } | undefined)?.value;
	};
	const evaluateString = async (expression: string): Promise<string> => {
		const value = await evaluate(expression);
		if (typeof value !== 'string')
			throw new Error('evaluate returned no string');
		return value;
	};

	await send('Page.enable', {});
	await send('Page.setLifecycleEventsEnabled', { enabled: true });
	await send('Network.enable', {});
	await send('Log.enable', {});

	const navigated = await send('Page.navigate', { url });
	if (typeof navigated.errorText === 'string') {
		throw new Error(`Navigate failed: ${navigated.errorText}`);
	}
	navigating = true;
	const deadline = Date.now() + NAVIGATION_TIMEOUT_MS;
	while (navigating) {
		if (Date.now() >= deadline)
			throw new Error('The event waited for never came');
		await sleep(100);
	}
	await settle(evaluate);

	const probes = await pageProbe(evaluateString, signatures);
	const auth = await authProbe(evaluateString);
	const title = await evaluate('document.title').then(
		(value) => (typeof value === 'string' && value !== '' ? value : undefined),
		() => undefined,
	);
	const tabUrl = targetUrl;
	const bodyHtml = await evaluateString(GET_CONTENT).catch(() => '');
	const screenshot = await captureScreenshot(send, evaluateString, url);

	const finalUrl =
		document !== undefined && document.url !== '' ? document.url : tabUrl;
	return Object.freeze({
		finalUrl,
		title,
		bodyHtml,
		status: document?.status,
		headers: document?.headers,
		probes,
		auth,
		consoleErrors,
		screenshot,
		renderMs: Date.now() - started,
	});
}

/** `Tab::get_content`. */
const GET_CONTENT = `
            (function () {
                let retVal = '';
                if (document.doctype)
                    retVal = new XMLSerializer().serializeToString(document.doctype);
                if (document.documentElement)
                    retVal += document.documentElement.outerHTML;
                return retVal;
            })();`;

/** `document.readyState` to `complete`, at most five seconds, then a grace. */
async function settle(
	evaluate: (expression: string) => Promise<unknown>,
): Promise<void> {
	const deadline = Date.now() + 5_000;
	while (Date.now() < deadline) {
		const ready = await evaluate('document.readyState').catch(() => undefined);
		if (ready === 'complete') break;
		await sleep(100);
	}
	await sleep(500);
}

async function pageProbe(
	evaluateString: (expression: string) => Promise<string>,
	signatures: readonly Signature[],
): Promise<ReadonlyMap<string, ProbeResult>> {
	const payload = signatures.map((signature) => ({
		key: signature.key,
		scriptSubstrings: signature.scriptSubstrings,
		selectors: signature.selectors,
		globals: signature.globals,
	}));
	const script = `(() => {
  const probes = ${JSON.stringify(payload)};
  const scripts = Array.from(document.getElementsByTagName('script')).map(s => s.src);
  const result = {};
  for (const probe of probes) {
    result[probe.key] = {
      script: probe.scriptSubstrings.find(sub => scripts.some(src => src.includes(sub))) ?? null,
      selector: probe.selectors.find(sel => { try { return document.querySelector(sel) !== null; } catch { return false; } }) ?? null,
      global: probe.globals.find(name => name in window) ?? null,
    };
  }
  return JSON.stringify(result);
})()`;
	const raw = await evaluateString(script);
	const parsed = JSON.parse(raw) as Record<string, Record<string, unknown>>;
	const signal = (value: unknown): string | undefined =>
		typeof value === 'string' ? value : undefined;
	return new Map(
		Object.entries(parsed).map(([key, value]) => [
			key,
			Object.freeze({
				script: signal(value.script),
				selector: signal(value.selector),
				global: signal(value.global),
			}),
		]),
	);
}

const AUTH_SCRIPT = `(() => {
  const form = (() => {
    const passwordInputs = document.querySelectorAll('input[type="password"]');
    if (passwordInputs.length === 0) return { hasPasswordInput: false, hasForm: false, hasUsernameInput: false, action: null };
    const passwordInput = passwordInputs[0];
    const f = passwordInput ? passwordInput.closest('form') : null;
    if (f) {
      const hasUsernameInput =
        f.querySelector('input[type="text"]') !== null ||
        f.querySelector('input[type="email"]') !== null ||
        f.querySelector('input[name*="user"]') !== null ||
        f.querySelector('input[name*="email"]') !== null;
      return { hasPasswordInput: true, hasForm: true, hasUsernameInput, action: f.action || null };
    }
    return { hasPasswordInput: true, hasForm: false, hasUsernameInput: false, action: null };
  })();
  const text = document.body ? document.body.innerText.toLowerCase() : '';
  const keywords = ['sign in','log in','login required','please log in','authentication required','access denied','unauthorized access','members only','please sign in'];
  let keyword = null;
  for (const k of keywords) { if (text.includes(k)) { keyword = k; break; } }
  return JSON.stringify({ form, keyword });
})()`;

async function authProbe(
	evaluateString: (expression: string) => Promise<string>,
): Promise<AuthPageEvidence> {
	const parsed = JSON.parse(await evaluateString(AUTH_SCRIPT)) as {
		form?: Record<string, unknown>;
		keyword?: unknown;
	};
	const form = parsed.form ?? {};
	return Object.freeze({
		hasPasswordInput: form.hasPasswordInput === true,
		hasForm: form.hasForm === true,
		hasUsernameInput: form.hasUsernameInput === true,
		formAction: typeof form.action === 'string' ? form.action : undefined,
		keyword: typeof parsed.keyword === 'string' ? parsed.keyword : undefined,
	});
}

/**
 * A full-page PNG in the working directory, named for the URL and the day.
 * The capture is documentation, never evidence a finding rests on, so any
 * failure here leaves the report without a screenshot rather than failing it.
 */
async function captureScreenshot(
	send: (
		method: string,
		params?: Record<string, unknown>,
	) => Promise<Record<string, unknown>>,
	evaluateString: (expression: string) => Promise<string>,
	url: string,
): Promise<string | undefined> {
	const filename = screenshotName(url, civilDateToday());
	if (filename === undefined) return undefined;
	const resized = await resizeToDocument(send, evaluateString);
	const png = await send('Page.captureScreenshot', {
		format: 'png',
		fromSurface: true,
	}).then(
		(result) =>
			typeof result.data === 'string'
				? Buffer.from(result.data, 'base64')
				: undefined,
		() => undefined,
	);
	if (resized)
		await send('Emulation.clearDeviceMetricsOverride').catch(() => undefined);
	if (png === undefined) return undefined;
	try {
		writeFileSync(filename, png);
	} catch {
		return undefined;
	}
	return `./${filename}`;
}

async function resizeToDocument(
	send: (
		method: string,
		params?: Record<string, unknown>,
	) => Promise<Record<string, unknown>>,
	evaluateString: (expression: string) => Promise<string>,
): Promise<boolean> {
	let size: { w?: unknown; h?: unknown };
	try {
		size = JSON.parse(
			await evaluateString(
				'JSON.stringify({w:Math.max(document.documentElement.scrollWidth,document.body?document.body.scrollWidth:0),h:Math.max(document.documentElement.scrollHeight,document.body?document.body.scrollHeight:0)})',
			),
		) as { w?: unknown; h?: unknown };
	} catch {
		return false;
	}
	const { w, h } = size;
	if (typeof w !== 'number' || typeof h !== 'number') return false;
	if (w <= 0 || h <= 0) return false;
	return send('Emulation.setDeviceMetricsOverride', {
		width: Math.trunc(Math.min(w, MAX_CAPTURE_PX)),
		height: Math.trunc(Math.min(h, MAX_CAPTURE_PX)),
		deviceScaleFactor: 1,
		mobile: false,
	}).then(
		() => true,
		() => false,
	);
}

/** `scrape-le-<host>-<date>-<fnv1a of the whole URL>.png`. */
export function screenshotName(
	url: string,
	date: readonly [number, number, number],
): string | undefined {
	let hostname: string;
	try {
		hostname = new URL(url).hostname;
	} catch {
		return undefined;
	}
	if (hostname === '') return undefined;
	const [year, month, day] = date;
	const pad = (value: number, width: number) =>
		String(value).padStart(width, '0');
	return `scrape-le-${hostname.replace(/\./g, '-')}-${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}-${digest(url).toString(16).padStart(8, '0')}.png`;
}

function digest(url: string): number {
	let hash = 0x811c9dc5;
	for (const byte of Buffer.from(url, 'utf8')) {
		hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
	}
	return hash >>> 0;
}

/** The UTC civil date, as the crate derives it from the system clock. */
function civilDateToday(): [number, number, number] {
	const now = new Date();
	return [now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate()];
}
