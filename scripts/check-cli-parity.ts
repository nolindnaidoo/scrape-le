/**
 * Requires the npm command line to behave exactly as the Rust one does.
 *
 * Both install a command named `scrape-le`, so a person or a CI step cannot
 * tell which one they have. This is a different contract from
 * `check-differential.ts`, which holds the two `analyze_robots_txt` tools
 * equal: here the whole terminal surface is compared, the arguments, the HTTP
 * requests and what is made of their answers, the rendered checks, batching,
 * the exit codes, stdout and stderr, and every reply `scrape-le mcp` gives.
 *
 * Every case runs both binaries against one local fixture server with stdout
 * piped, which is how a script sees them, each in a working directory of its
 * own so the screenshots they write can be compared by name.
 *
 * **What is masked, and why.** Only what no two runs share:
 *   - the milliseconds in `timing_ms` and in the summary line, and the
 *     seconds a batch took;
 *   - the text of a `--signatures` file the `toml` crate refuses, and of a
 *     batch file serde_json refuses. Both crates render their own parse
 *     errors, with a caret under the offending column, and that rendering is
 *     not reproduced. That the file is refused, the exit code and the words
 *     before the parser's own are compared.
 * The screenshots' bytes differ by a pixel here and there between two runs of
 * one browser, so their names are compared and their contents are not.
 *
 * Rendered cases need a Chromium. CI installs one wherever the runner lacks it
 * and sets SCRAPE_LE_PARITY_RENDER=1, which turns a missing browser into a
 * failure rather than a quiet skip.
 *
 * Run: bun run build:cli && cargo build --locked --manifest-path crate/Cargo.toml
 *      bun scripts/check-cli-parity.ts
 */
import { spawn } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmdirSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { findBrowser } from '../src/cli/browser';

const ROOT = join(import.meta.dir, '..');
const RUST =
	process.env.SCRAPE_LE_BIN ??
	join(ROOT, 'crate', 'target', 'debug', `scrape-le${process.platform === 'win32' ? '.exe' : ''}`);
const NODE_CLI = join(ROOT, 'cli', 'cli.js');
/**
 * Node, by name, not `process.execPath`: this script runs under Bun, and the
 * package is run by Node wherever `npx` runs it. Bun's errors are not Node's.
 */
const NODE = process.env.NODE_BIN ?? 'node';

for (const [label, path] of [
	['the Rust binary', RUST],
	['cli/cli.js', NODE_CLI],
] as const) {
	if (!existsSync(path)) {
		console.error(`FAIL: ${label} is missing at ${path}. Build it first.`);
		process.exit(1);
	}
}

const browser = findBrowser();
const renderRequired = process.env.SCRAPE_LE_PARITY_RENDER === '1';
if (!browser.ok && renderRequired) {
	console.error(`FAIL: rendered cases were required and ${browser.reason}`);
	process.exit(1);
}

// ---------------------------------------------------------------- fixtures

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

function html(title: string | undefined, body = ''): string {
	const head = title === undefined ? '' : `<title>${title}</title>`;
	return `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
}

function page(response: ServerResponse, content: string, headers: Record<string, string> = {}, status = 200): void {
	response.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...headers });
	response.end(content);
}

function redirect(response: ServerResponse, status: number, location?: string): void {
	response.writeHead(status, location === undefined ? {} : { location });
	response.end();
}

let mainPort = 0;
let otherPort = 0;

const MAIN_ROBOTS = [
	'User-agent: *',
	'Disallow: /private',
	'Allow: /private/open',
	'Disallow: /*.pdf$',
	'Disallow: /café',
	'Crawl-delay: 0.2',
	'Sitemap: http://example.invalid/sitemap.xml',
	'',
	'User-agent: MyBot',
	'Disallow: /',
	'Crawl-delay: 1',
	'',
].join('\n');

const ROUTES: Readonly<Record<string, Handler>> = {
	'/page': (_, res) => page(res, html('Page')),
	'/notitle': (_, res) => page(res, html(undefined, '<p>no title</p>')),
	'/emptytitle': (_, res) => page(res, html('   ')),
	'/upper': (_, res) => page(res, '<HTML><HEAD><TITLE> Upper Case </TITLE></HEAD></HTML>'),
	'/entity': (_, res) => page(res, html('Fish &amp; Chips — été')),
	'/bom': (_, res) => page(res, `﻿${html('With BOM')}`),
	'/private/x': (_, res) => page(res, html('Private')),
	'/private/open/y': (_, res) => page(res, html('Open')),
	'/doc.pdf': (_, res) => page(res, html('PDF')),
	'/ratelimit': (_, res) =>
		page(res, html('RL'), {
			'x-ratelimit-limit': '100',
			'x-ratelimit-remaining': '99',
			'x-ratelimit-reset': '60',
		}),
	'/ratelimit-ietf': (_, res) =>
		page(res, html('RL'), { 'ratelimit-limit': '10', 'retry-after': '30', 'x-ratelimit-limit': '' }),
	'/429': (_, res) => page(res, html('Slow down'), { 'retry-after': '120' }, 429),
	'/429-bare': (_, res) => page(res, html('Slow down'), {}, 429),
	'/401': (_, res) => page(res, html('Unauthorized'), {}, 401),
	'/403': (_, res) => page(res, html('Forbidden'), {}, 403),
	'/500': (_, res) => page(res, html('Error'), {}, 500),
	'/204': (_, res) => {
		res.writeHead(204);
		res.end();
	},
	'/login': (_, res) => page(res, html('Login')),
	'/account/sign-in/now': (_, res) => page(res, html('Sign in')),
	'/author/jane': (_, res) => page(res, html('Author')),
	'/cf': (_, res) => page(res, html('CF'), { 'cf-ray': '8a1b2c3d4e5f-LHR' }),
	'/cf-server': (_, res) => page(res, html('CF'), { server: 'CloudFlare' }),
	'/cf-empty': (_, res) => page(res, html('CF'), { 'cf-ray': '' }),
	'/dd': (_, res) => page(res, html('DD'), { 'x-datadome-cid': 'abc', server: 'DataDome' }),
	'/nginx': (_, res) => page(res, html('Nginx'), { server: 'nginx' }),
	'/dup': (_, res) => {
		res.writeHead(200, [
			['content-type', 'text/html'],
			['x-ratelimit-limit', '1'],
			['X-RateLimit-Limit', '2'],
		]);
		res.end(html('Dup'));
	},
	'/binheader': (_, res) => {
		res.writeHead(200, [
			['content-type', 'text/html'],
			['cf-ray', Buffer.from([0x63, 0xe9]).toString('latin1')],
			['x-ratelimit-remaining', Buffer.from([0xff]).toString('latin1')],
		]);
		res.end(html('Bin'));
	},
	'/gzip': (_, res) => {
		res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' });
		res.end(gzipSync(html('Zipped')));
	},
	'/gzip-bad': (_, res) => {
		res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' });
		res.end('<title>not gzip</title>');
	},
	'/chunked': (_, res) => {
		res.writeHead(200, { 'content-type': 'text/html', 'transfer-encoding': 'chunked' });
		res.write('<html><head><ti');
		res.write('tle>Chunked</title></head>');
		res.end('</html>');
	},
	'/latin1': (_, res) => {
		res.writeHead(200, { 'content-type': 'text/html' });
		res.end(Buffer.concat([Buffer.from('<title>caf'), Buffer.from([0xe9]), Buffer.from('</title>')]));
	},
	'/big': (_, res) => {
		res.writeHead(200, { 'content-type': 'text/html' });
		res.end(`<title>Big</title>${'x'.repeat(2 * 1024 * 1024)}`);
	},
	'/exactly-limit': (_, res) => {
		const head = '<title>Edge</title>';
		res.writeHead(200, { 'content-type': 'text/html' });
		res.end(`${head}${'y'.repeat(2 * 1024 * 1024 - head.length)}`);
	},
	'/redirect-abs': (_, res) => redirect(res, 301, `http://127.0.0.1:${mainPort}/page`),
	'/redirect-rel/from': (_, res) => redirect(res, 302, 'to?x=1'),
	'/redirect-rel/to': (_, res) => page(res, html('Relative target')),
	'/redirect-root': (_, res) => redirect(res, 303, '/page?from=root#frag'),
	'/redirect-dotdot/a/b': (_, res) => redirect(res, 307, '../../page'),
	'/redirect-above-root': (_, res) => redirect(res, 302, '../../../page'),
	'/redirect-proto-rel': (_, res) => redirect(res, 308, `//127.0.0.1:${mainPort}/page`),
	'/redirect-other-host': (_, res) => redirect(res, 302, `http://localhost:${otherPort}/page`),
	'/redirect-missing': (_, res) => redirect(res, 302),
	'/redirect-bad': (_, res) => redirect(res, 302, '/has space'),
	'/redirect-login': (_, res) => redirect(res, 302, '/login'),
	'/redirect-304': (_, res) => redirect(res, 304, '/page'),
	'/close': (req) => req.socket.destroy(),
	'/turnstile': (_, res) => page(res, html('Turnstile', '<div class="cf-turnstile"></div>')),
	'/scripts': (_, res) =>
		page(
			res,
			html(
				'Scripts',
				`<script src="/challenges.cloudflare.com/x.js"></script><script src="/px-cdn.net/main.js"></script><div class="g-recaptcha"></div>`,
			),
		),
	'/challenges.cloudflare.com/x.js': (_, res) => {
		res.writeHead(200, { 'content-type': 'text/javascript' });
		res.end('window.turnstile = {};');
	},
	'/px-cdn.net/main.js': (_, res) => {
		res.writeHead(200, { 'content-type': 'text/javascript' });
		res.end('window._pxAppId = "x";');
	},
	'/globals': (_, res) =>
		page(res, html('Globals', '<script>window.grecaptcha = {}; window.ddjskey = "k"; window.hcaptcha = {};</script>')),
	'/hcaptcha': (_, res) => page(res, html('H', '<div data-hcaptcha-response=""></div>')),
	'/loginform': (_, res) =>
		page(
			res,
			html(
				'Sign in',
				'<form action="/session" method="post"><input type="email" name="email"><input type="password" name="pw"></form>',
			),
		),
	'/password-only': (_, res) => page(res, html('PW', '<input type="password">')),
	'/password-noform-user': (_, res) =>
		page(res, html('PW', '<form><input type="password"></form><input name="username">')),
	'/keyword': (_, res) => page(res, html('Members', '<p>This area is Members Only. Please sign in.</p>')),
	'/console': (_, res) =>
		page(res, html('Console', `<img src="/missing.png"><script>console.error('boom'); undefinedFunction();</script>`)),
	'/iframe': (_, res) => page(res, html('Frame', '<iframe src="/frame-inner"></iframe>')),
	'/frame-inner': (_, res) => page(res, html('Inner'), { 'cf-ray': 'inner' }),
	'/js-title': (_, res) =>
		page(res, html('Before', '<script>document.title = "After";</script>')),
	'/js-redirect': (_, res) =>
		page(res, html('Leaving', '<script>history.replaceState(null, "", "/login");</script>')),
	'/tall': (_, res) => page(res, html('Tall', '<div style="height:3000px;width:2000px"></div>')),
};

function mainHandler(request: IncomingMessage, response: ServerResponse): void {
	const path = (request.url ?? '/').split('?')[0] ?? '/';
	if (path === '/robots.txt') {
		response.writeHead(200, { 'content-type': 'text/plain' });
		response.end(MAIN_ROBOTS);
		return;
	}
	const route = ROUTES[path];
	if (route) {
		route(request, response);
		return;
	}
	page(response, html('Not found'), {}, 404);
}

/** A host whose robots.txt is whatever this run needs of it. */
function robotsServer(robots: Handler): Handler {
	return (request, response) => {
		if (request.url === '/robots.txt') {
			robots(request, response);
			return;
		}
		mainHandler(request, response);
	};
}

const servers: Server[] = [];

function listen(handler: Handler): Promise<number> {
	const server = createServer(handler);
	servers.push(server);
	return new Promise((resolve) => {
		server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
	});
}

// ------------------------------------------------------------------ cases

type Case = Readonly<{
	args: readonly string[];
	stdin?: string;
	env?: Readonly<Record<string, string>>;
	render?: boolean;
}>;

type Outcome = Readonly<{ status: number | null; stdout: string; stderr: string; shots: string }>;

const scratch = mkdtempSync(join(tmpdir(), 'scrape-le-cli-parity-'));
const made: string[] = [];
const madeDirs: string[] = [scratch];

function file(name: string, content: string | Buffer): string {
	const path = join(scratch, name);
	writeFileSync(path, content);
	made.push(path);
	return path;
}

function directory(name: string): string {
	const path = join(scratch, name);
	mkdirSync(path);
	madeDirs.push(path);
	return path;
}

function cases(ports: Readonly<Record<string, number>>): readonly Case[] {
	const main = `http://127.0.0.1:${ports.main}`;
	const local = `http://localhost:${ports.other}`;
	const at = (port: number, path: string) => `http://127.0.0.1:${port}${path}`;
	const http = (args: readonly string[]): Case => ({ args: ['--no-render', ...args] });

	const urlsJson = file('urls.json', JSON.stringify([`${main}/page`, `${main}/private/x`, `${main}/page`]));
	const urlsObjects = file(
		'objects.json',
		JSON.stringify([{ url: `${main}/ratelimit`, note: 'x' }, { url: `${local}/page` }]),
	);
	const urlsCsv = file('urls.csv', `note,URL\nfirst,${main}/page\nsecond,"${main}/cf"\nthird,\n`);
	const urlsTxt = file(
		'urls.txt',
		[`# a comment`, `${main}/page`, '', `  ${local}/login  `, 'ftp://x', 'mailto:x@y.com', 'not a url at all', `warn: ${main}/401 happened`, `(${main}/403)`, `HTTPS://nonexistent.invalid/x`].join('\n'),
	);
	const urlsBom = file('bom.json', `﻿${JSON.stringify([`${main}/page`])}`);
	const urlsBomCsv = file('bom.csv', `﻿url\n${main}/page\n`);
	const urlsCrlf = file('crlf.txt', `${main}/page\r\n${main}/upper\r\n`);
	const empty = file('empty.txt', '\n# only a comment\n\n');
	const badJson = file('bad.json', '[ "a", ');
	const objectJson = file('object.json', '{"url": "x"}');
	const noKey = file('nokey.json', JSON.stringify([{ link: 'x' }]));
	const numbers = file('numbers.json', '[1, 2]');
	const allBad = file('allbad.txt', 'ftp://x\nmailto:y@z.com\n');
	const dnsBatch = file('dns.txt', `${main}/page\nhttps://nonexistent.invalid/\n`);
	const latin1Input = file('latin1.txt', Buffer.from([0x68, 0x74, 0xe9, 0x0a]));
	const dir = directory('a-directory');
	const signatures = file(
		'sigs.toml',
		'[[signature]]\nkey = "cloudflare"\nlabel = "Cloudflare (patched)"\nscript_substrings = ["px-cdn.net"]\n\n[[headers]]\n\n[[signature]]\nkey = "kasada"\nlabel = "Kasada"\nglobals = ["KPSDK"]\n\n[[signature.headers]]\nname = "x-kpsd-ct"\n',
	);
	const oneSignature = file('one.toml', 'key = "nginx"\nlabel = "Nginx"\nheaders = [{ name = "server", contains = "nginx" }]\n');
	const badToml = file('bad.toml', 'key = \n');
	const noKeyToml = file('nokey.toml', 'label = "x"\n');
	const wrongType = file('wrongtype.toml', 'key = "a"\nlabel = 5\n');


	return [
		{ args: ['--help'] },
		{ args: ['-h'] },
		{ args: ['--version'] },
		{ args: ['-V'] },
		{ args: [] },
		{ args: ['--no-render'] },
		{ args: ['--bogus'] },
		{ args: ['-'] },
		{ args: ['--agent'] },
		{ args: ['--input'] },
		{ args: ['--signatures'] },
		{ args: ['--concurrency'] },
		{ args: ['--concurrency', 'x', `${main}/page`] },
		{ args: ['--concurrency', '0', `${main}/page`] },
		{ args: ['--concurrency', '-1', `${main}/page`] },
		{ args: ['--concurrency', '1.5', `${main}/page`] },
		{ args: ['--concurrency', '99999999999999999999', `${main}/page`] },
		{ args: ['--no-render', '--concurrency', '+2', `${main}/page`] },
		{ args: [`${main}/page`, '--help'] },
		{ args: ['--bogus', '--help'] },
		{ args: ['--signatures', join(scratch, 'missing.toml'), '--no-render', `${main}/page`] },
		{ args: ['--signatures', dir, '--no-render', `${main}/page`] },
		{ args: ['--signatures', badToml, '--no-render', `${main}/page`] },
		{ args: ['--signatures', noKeyToml, '--no-render', `${main}/page`] },
		{ args: ['--signatures', wrongType, '--no-render', `${main}/page`] },
		{ args: ['--signatures', signatures, '--no-render', `${main}/cf`] },
		{ args: ['--signatures', oneSignature, '--no-render', `${main}/nginx`] },
		{ args: ['--signatures', signatures, '--version'] },
		http(['ftp://example.com']),
		http(['javascript:alert(1)']),
		http(['mailto:x@y.com']),
		http(['data:text/html,hi']),
		http(['']),
		http(['   ']),
		http(['not a url']),
		http([`HTTP://127.0.0.1:${ports.main}/page`]),
		http([`127.0.0.1:${ports.main}/page`]),
		http(['https://nonexistent.invalid/']),
		http(['nonexistent.invalid']),
		http([at(ports.closed, '/x')]),
		...[
			'/page',
			'',
			'/',
			'/page?x=1#frag',
			'/notitle',
			'/emptytitle',
			'/upper',
			'/entity',
			'/bom',
			'/private/x',
			'/private/open/y',
			'/doc.pdf',
			'/café',
			'/caf%C3%A9',
			'/ratelimit',
			'/ratelimit-ietf',
			'/429',
			'/429-bare',
			'/401',
			'/403',
			'/500',
			'/204',
			'/missing',
			'/login',
			'/account/sign-in/now',
			'/author/jane',
			'/cf',
			'/cf-server',
			'/cf-empty',
			'/dd',
			'/nginx',
			'/dup',
			'/binheader',
			'/gzip',
			'/gzip-bad',
			'/chunked',
			'/latin1',
			'/big',
			'/exactly-limit',
			'/redirect-abs',
			'/redirect-rel/from',
			'/redirect-root',
			'/redirect-dotdot/a/b',
			'/redirect-above-root',
			'/redirect-proto-rel',
			'/redirect-other-host',
			'/redirect-missing',
			'/redirect-bad',
			'/redirect-login',
			'/redirect-304',
			'/a b',
			'/a|b',
			'/a"b{c}',
			'/q?a b',
			'/close',
		].map((path) => http([`${main}${path}`])),
		http(['--agent', 'MyBot/2.0', `${main}/page`]),
		http(['--agent', 'mybot', `${main}/page`]),
		http(['--agent', 'OtherBot', `${main}/private/x`]),
		http(['--agent', '', `${main}/private/x`]),
		http(['--agent', '/1.0', `${main}/page`]),
		http(['--agent', 'MyBot', `http://user:p%40ss@127.0.0.1:${ports.main}/page`]),
		http([at(ports.noRobots, '/page')]),
		http([at(ports.brokenRobots, '/page')]),
		http([at(ports.redirectRobots, '/page')]),
		http([at(ports.infinite, '/page')]),
		http([at(ports.huge, '/page')]),
		http([at(ports.fraction, '/page')]),
		http([at(ports.gzipRobots, '/page')]),
		http(['--agent', 'Bot', at(ports.agentOnly, '/private/x')]),
		http(['--ignore-crawl-delay', `${main}/page`]),
		http([`${main}/page`, `${main}/private/x`]),
		http(['--concurrency', '1', `${main}/page`, `${local}/page`, `${main}/401`]),
		http(['--concurrency', '1', `${main}/page`, 'https://nonexistent.invalid/']),
		http(['--concurrency', '1', `${main}/page`, 'example.invalid', 'ftp://x']),
		http(['--input', urlsJson]),
		http(['--input', urlsJson, '--ignore-crawl-delay']),
		http(['--concurrency', '1', '--input', urlsObjects]),
		http(['--input', urlsCsv]),
		http(['--concurrency', '1', '--input', urlsTxt]),
		http(['--input', urlsBom]),
		http(['--input', urlsBomCsv]),
		http(['--input', urlsCrlf]),
		http(['--input', empty]),
		http(['--input', badJson]),
		http(['--input', objectJson]),
		http(['--input', noKey]),
		http(['--input', numbers]),
		http(['--input', allBad]),
		http(['--concurrency', '1', '--input', dnsBatch]),
		http(['--input', latin1Input]),
		http(['--input', dir]),
		http(['--input', join(scratch, 'nowhere.json')]),
		{ args: ['--no-render', '--input', '-'], stdin: `${main}/page\n${main}/upper\n` },
		{ args: ['--no-render', '--input', '-'], stdin: '' },
		{ args: ['--no-render', '--input', '-', `${main}/ignored`], stdin: `${main}/page\n` },
		{ args: ['doctor'] },
		{ args: ['doctor', '--help'] },
		{ args: ['doctor'], env: { CHROME: join(scratch, 'no-such-browser') } },
		{ args: [`${main}/page`], env: { CHROME: join(scratch, 'no-such-browser') } },
		...(browser.ok
			? [
					'/page',
					'/notitle',
					'/private/x',
					'/401',
					'/redirect-abs',
					'/redirect-login',
					'/turnstile',
					'/scripts',
					'/globals',
					'/hcaptcha',
					'/loginform',
					'/password-only',
					'/password-noform-user',
					'/keyword',
					'/console',
					'/iframe',
					'/js-title',
					'/js-redirect',
					'/tall',
					'/missing',
				].map((path): Case => ({ args: [`${main}${path}`], render: true }))
			: []),
		...(browser.ok
			? [
					{ args: [at(ports.closed, '/x')], render: true },
					{ args: ['--signatures', signatures, `${main}/scripts`], render: true },
					{ args: ['--concurrency', '1', `${main}/page`, `${local}/turnstile`], render: true },
				]
			: []),
	];
}

function normalise(text: string): string {
	return text
		.replace(/"(fetch|render|total)\\?": ?\d+/g, (match) => match.replace(/\d+$/, 'N'))
		.replace(/ · \d+ms · exit /g, ' · Nms · exit ')
		.replace(/ host\(s\) in \d+\.\d+s\n/g, ' host(s) in Ns\n')
		.replace(/(\.toml: )[\s\S]*$/, '$1<the toml crate’s rendering>\n')
		.replace(/(input is not valid JSON: )[^\n]*/, '$1<serde_json’s wording>');
}

/**
 * A batch names an entry that could not be checked from the worker that ran
 * it, while the reports are printed by another thread, so where that line
 * lands among the reports is a race inside the crate itself. The lines are
 * compared as a set, and everything around them in order.
 */
function entriesApart(stderr: string): string {
	const entry = /^scrape-le: entry \d+: .*\n/gm;
	const entries = (stderr.match(entry) ?? []).sort();
	if (entries.length === 0) return stderr;
	return `${stderr.replace(entry, '')}--- entries ---\n${entries.join('')}`;
}

function execute(
	program: string,
	args: readonly string[],
	cwd: string,
	stdin: string,
	env: Readonly<Record<string, string>>,
): Promise<{ status: number | null; stdout: string; stderr: string }> {
	return new Promise((resolve) => {
		const child = spawn(program, args, { cwd, env: { ...process.env, ...env } });
		const out: Buffer[] = [];
		const err: Buffer[] = [];
		child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
		child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
		child.on('close', (status) =>
			resolve({
				status,
				stdout: Buffer.concat(out).toString('utf8'),
				stderr: Buffer.concat(err).toString('utf8'),
			}),
		);
		child.stdin.end(stdin);
	});
}

/** The screenshots a run wrote, by name, removed once they are listed. */
function takeShots(cwd: string): string {
	const shots = readdirSync(cwd).filter((name) => name.endsWith('.png')).sort();
	for (const name of shots) unlinkSync(join(cwd, name));
	return shots.join(', ');
}

async function outcome(command: readonly string[], testCase: Case, cwd: string): Promise<Outcome> {
	const [program, ...rest] = command as [string, ...string[]];
	const result = await execute(program, [...rest, ...testCase.args], cwd, testCase.stdin ?? '', testCase.env ?? {});
	return {
		status: result.status,
		stdout: normalise(result.stdout),
		stderr: entriesApart(normalise(result.stderr)),
		shots: takeShots(cwd),
	};
}

async function compareCli(all: readonly Case[], rustCwd: string, nodeCwd: string): Promise<string[]> {
	const failures: string[] = [];
	for (const testCase of all) {
		const rust = await outcome([RUST], testCase, rustCwd);
		const node = await outcome([NODE, NODE_CLI], testCase, nodeCwd);
		for (const field of ['status', 'stdout', 'stderr', 'shots'] as const) {
			if (rust[field] === node[field]) continue;
			failures.push(
				`scrape-le ${testCase.args.join(' ')}\n  ${field} differs\n` +
					`  rust: ${JSON.stringify(rust[field])}\n  node: ${JSON.stringify(node[field])}`,
			);
		}
	}
	return failures;
}

// -------------------------------------------------------------------- mcp

function mcpRequests(ports: Readonly<Record<string, number>>): readonly unknown[] {
	const main = `http://127.0.0.1:${ports.main}`;
	const call = (id: number, name: string, args?: unknown) => ({
		jsonrpc: '2.0',
		id,
		method: 'tools/call',
		params: args === undefined ? { name } : { name, arguments: args },
	});
	const robots = 'User-agent: *\nDisallow: /admin\nDisallow: /tmp\nCrawl-delay: 10\nSitemap: https://e.com/s.xml\n';
	return [
		{ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
		{ jsonrpc: '2.0', method: 'notifications/initialized' },
		{ jsonrpc: '2.0', id: 'two', method: 'tools/list' },
		{ jsonrpc: '2.0', id: 3, method: 'ping' },
		{ jsonrpc: '2.0', id: null, method: 'ping' },
		{ jsonrpc: '2.0', id: 4, method: 'resources/list' },
		{ jsonrpc: '2.0', id: 5, method: 'tools/call' },
		{ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { arguments: {} } },
		{ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'nope' } },
		{ id: 8 },
		'not json at all',
		call(10, 'analyze_robots_txt', { content: robots, path: '/admin/x' }),
		call(11, 'analyze_robots_txt', { content: robots, path: 'https://e.com/tmp?q' }),
		call(12, 'analyze_robots_txt', { content: robots, path: 'admin' }),
		call(13, 'analyze_robots_txt', { content: robots, path: '/ok', maxResults: 1 }),
		call(14, 'analyze_robots_txt', { content: robots, path: '/ok', maxResults: 0 }),
		call(15, 'analyze_robots_txt', { content: robots, path: '/ok', maxResults: 2.5 }),
		call(16, 'analyze_robots_txt', { content: robots, path: '/ok', maxResults: 99999 }),
		call(17, 'analyze_robots_txt', { content: robots, path: '/ok', maxResults: null }),
		call(18, 'analyze_robots_txt', { content: robots, path: '/ok', agent: 7 }),
		call(19, 'analyze_robots_txt', { content: robots, path: '/ok', agent: null }),
		call(20, 'analyze_robots_txt', { content: robots }),
		call(21, 'analyze_robots_txt', { path: '/x' }),
		call(22, 'analyze_robots_txt', { content: 'User-agent: *\nCrawl-delay: 0.5\n', path: '/' }),
		call(23, 'analyze_robots_txt', { content: 'User-agent: *\nCrawl-delay: 1e21\n', path: '/' }),
		call(24, 'analyze_robots_txt', { content: 'User-agent: *\nCrawl-delay: Infinity\n', path: '/' }),
		call(25, 'analyze_robots_txt', { content: 'User-agent: *\nCrawl-delay: 1e18\n', path: '/' }),
		call(26, 'analyze_robots_txt', { content: 'User-agent: *\nCrawl-delay: 0.1e-7\n', path: '/' }),
		call(27, 'analyze_robots_txt', { content: 'User-agent: *\nCrawl-delay: -0\n', path: '/' }),
		call(28, 'analyze_robots_txt', { content: 'User-agent: x\nDisallow: /café\n', path: '/café', agent: 'X/1' }),
		call(29, 'analyze_robots_txt', 'not an object'),
		call(30, 'scrape_le_check', { url: `${main}/page`, render: false }),
		call(31, 'scrape_le_check', { urls: [`${main}/page`, `${main}/private/x`, 7], render: false, agent: 'MyBot' }),
		call(32, 'scrape_le_check', { url: 'ftp://x', render: false }),
		call(33, 'scrape_le_check', { url: 'https://nonexistent.invalid/', render: false }),
		call(34, 'scrape_le_check', { urls: [], render: false }),
		call(35, 'scrape_le_check', { urls: [7] }),
		call(36, 'scrape_le_check', {}),
		call(37, 'scrape_le_check', { url: 7, urls: [`${main}/429`], render: 'no' }),
		call(38, 'scrape_le_check', { url: `${main}/ratelimit`, render: false }),
		call(39, 'scrape_le_doctor'),
		call(40, 'scrape_le_doctor', { anything: true }),
		...(browser.ok ? [call(41, 'scrape_le_check', { url: `${main}/loginform` })] : []),
	];
}

async function serveMcp(command: readonly string[], requests: readonly unknown[], cwd: string): Promise<string[]> {
	const [program, ...rest] = command as [string, ...string[]];
	const input = `${requests.map((request) => (typeof request === 'string' ? request : JSON.stringify(request))).join('\n')}\n\n`;
	const result = await execute(program, [...rest, 'mcp'], cwd, input, {});
	return normalise(result.stdout).split('\n').filter(Boolean);
}

async function compareMcp(ports: Readonly<Record<string, number>>, rustCwd: string, nodeCwd: string): Promise<string[]> {
	const requests = mcpRequests(ports);
	const rust = await serveMcp([RUST], requests, rustCwd);
	const node = await serveMcp([NODE, NODE_CLI], requests, nodeCwd);
	const shots = [takeShots(rustCwd), takeShots(nodeCwd)];
	const failures: string[] = [];
	const lines = Math.max(rust.length, node.length);
	for (let i = 0; i < lines; i += 1) {
		if (rust[i] === node[i]) continue;
		failures.push(`scrape-le mcp, reply ${i + 1}\n  rust: ${rust[i]}\n  node: ${node[i]}`);
	}
	if (shots[0] !== shots[1]) {
		failures.push(`scrape-le mcp screenshots\n  rust: ${shots[0]}\n  node: ${shots[1]}`);
	}
	return failures;
}

// ------------------------------------------------------------------- main

async function main(): Promise<number> {
	const robotsBody = (body: string, headers: Record<string, string> = {}): Handler =>
		robotsServer((_, res) => {
			res.writeHead(200, { 'content-type': 'text/plain', ...headers });
			res.end(body);
		});
	mainPort = await listen(mainHandler);
	otherPort = await listen(mainHandler);
	const ports = {
		main: mainPort,
		other: otherPort,
		noRobots: await listen(robotsServer((_, res) => page(res, 'gone', {}, 404))),
		brokenRobots: await listen(robotsServer((_, res) => page(res, 'oops', {}, 503))),
		redirectRobots: await listen(
			robotsServer((_, res) => redirect(res, 301, `http://127.0.0.1:${mainPort}/robots.txt`)),
		),
		infinite: await listen(robotsBody('User-agent: *\nCrawl-delay: Infinity\nDisallow: /nothing\n')),
		huge: await listen(robotsBody('User-agent: *\nCrawl-delay: 1e18\n')),
		fraction: await listen(robotsBody('User-agent: *\ncrawl-delay: 0.000001\nCrawl-delay: 2.50s\n')),
		gzipRobots: await listen(
			robotsServer((_, res) => {
				res.writeHead(200, { 'content-type': 'text/plain', 'content-encoding': 'gzip' });
				res.end(gzipSync('User-agent: *\nDisallow: /page\n'));
			}),
		),
		agentOnly: await listen(robotsBody('User-agent: bot\nUser-agent: other\nDisallow: /private\n\nUser-agent: *\nAllow: /\n')),
		closed: 0,
	};
	// A port that was listening and no longer is: connection refused.
	const doomed = createServer();
	ports.closed = await new Promise<number>((resolve) => {
		doomed.listen(0, '127.0.0.1', () => {
			const { port } = doomed.address() as AddressInfo;
			doomed.close(() => resolve(port));
		});
	});

	const rustCwd = directory('rust');
	const nodeCwd = directory('node');
	try {
		const all = cases(ports);
		const failures = [
			...(await compareCli(all, rustCwd, nodeCwd)),
			...(await compareMcp(ports, rustCwd, nodeCwd)),
		];
		if (failures.length > 0) {
			console.error(failures.join('\n\n'));
			console.error(`\nFAIL: ${failures.length} difference(s) between the npm and Rust CLIs`);
			return 1;
		}
		const rendered = browser.ok ? `, rendered with ${browser.path}` : ', HTTP only: no browser was found';
		console.log(
			`OK: the npm CLI matches the Rust CLI on ${all.length} commands and ${mcpRequests(ports).length} MCP requests${rendered}`,
		);
		return 0;
	} finally {
		for (const server of servers) server.close();
		for (const path of made) unlinkSync(path);
		for (const path of [...madeDirs].reverse()) rmdirSync(path);
	}
}

process.exit(await main());
