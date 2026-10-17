import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { groupByHost, parseInput, runBatch, waitFor } from './batch';
import { findBrowser } from './browser';
import { createRobotsCache, fetchEvidence } from './fetch';
import { httpGet } from './http';
import { displayUri, joinLocation, parseHttpUri, refusedUri } from './httpUri';
import { float, rustFloatDisplay, rustJsonFloat, toJson } from './json';
import { serve } from './mcp';
import { rustNetMessage } from './netError';
import { blockedReport, check, extractTitle, type Report } from './report';
import { parseRobots, unreachableRobots } from './robots';
import { human, parseArgs, run } from './run';
import { BUILT_IN, loadExtra, merge, parseExtra } from './signatures';
import { parseToml } from './toml';
import {
	extractUrl,
	rustTrim,
	targetInText,
	targetUrl,
	validateUrl,
} from './url';
import { FLAGS, USAGE } from './usage';

describe('usage', () => {
	it('names exactly the flags the parser accepts', () => {
		const named = new Set(USAGE.match(/(?<![\w-])--?[a-zA-Z][\w-]*/g));
		named.add('-h');
		named.add('-V');
		expect([...named].sort()).toEqual([...FLAGS].sort());
	});
});

describe('json', () => {
	it('writes floats the way serde_json does', () => {
		expect(rustJsonFloat(10)).toBe('10.0');
		expect(rustJsonFloat(0.2)).toBe('0.2');
		expect(rustJsonFloat(1e18)).toBe('1e+18');
		expect(rustJsonFloat(1e15)).toBe('1000000000000000.0');
		expect(rustJsonFloat(1e16)).toBe('1e+16');
		expect(rustJsonFloat(1.5e-6)).toBe('1.5e-6');
		expect(rustJsonFloat(0.00001)).toBe('0.00001');
		expect(rustJsonFloat(-0)).toBe('-0.0');
		expect(rustJsonFloat(Number.POSITIVE_INFINITY)).toBe('null');
	});

	it('displays floats the way Rust prints them', () => {
		expect(rustFloatDisplay(10)).toBe('10');
		expect(rustFloatDisplay(0.25)).toBe('0.25');
		expect(rustFloatDisplay(1e18)).toBe('1000000000000000000');
		expect(rustFloatDisplay(1e-7)).toBe('0.0000001');
		expect(rustFloatDisplay(Number.POSITIVE_INFINITY)).toBe('inf');
		expect(rustFloatDisplay(-0)).toBe('-0');
	});

	it('keeps struct order or sorts, and drops absent fields', () => {
		const value = { b: 1, a: { d: float(2), c: undefined }, e: [] };
		expect(toJson(value, { sorted: false })).toBe(
			'{"b":1,"a":{"d":2.0},"e":[]}',
		);
		expect(toJson(value, { sorted: true, indent: 2 })).toBe(
			'{\n  "a": {\n    "d": 2.0\n  },\n  "b": 1,\n  "e": []\n}',
		);
		expect(toJson(9223372036854775807n, { sorted: true })).toBe(
			'9223372036854775807',
		);
	});
});

describe('url', () => {
	it('trims what Rust trims', () => {
		expect(rustTrim('\u0085 x  ')).toBe('x');
		expect(rustTrim('﻿x')).toBe('﻿x');
	});

	it('prefixes a bare host and refuses another scheme', () => {
		expect(targetUrl('example.com')).toBe('https://example.com');
		expect(targetUrl('localhost:3000/x')).toBe('https://localhost:3000/x');
		expect(targetUrl('HTTP://Example.com/A')).toBe('http://Example.com/A');
		expect(targetUrl('ftp://example.com')).toBeUndefined();
		expect(targetUrl('mailto:x@y.com')).toBeUndefined();
		expect(targetUrl('')).toBeUndefined();
	});

	it('finds a URL inside a batch line', () => {
		expect(targetInText('warn: https://example.com/x happened')).toBe(
			'https://example.com/x',
		);
		expect(targetInText('(https://example.com/x)')).toBe(
			'https://example.com/x)',
		);
		expect(targetInText('mailto:x@y.com')).toBeUndefined();
		expect(extractUrl('')).toBeUndefined();
		expect(validateUrl('https://exa mple.com')).toBe(false);
	});
});

describe('robots', () => {
	const document = parseRobots(
		'User-agent: *\nDisallow: /private\nAllow: /private/open\nCrawl-delay: 2\n\nUser-agent: MyBot\nDisallow: /\nCrawl-delay: 5\nSitemap: https://e.com/s.xml\n',
	);

	it('answers the generic group and names the deciding rule', () => {
		const answer = document.evaluate('/private/x', undefined);
		expect(answer.allowsCrawling).toBe(false);
		expect(answer.matchedRule).toBe('/private');
		expect(answer.crawlDelay).toBe(2);
		expect(document.evaluate('/private/open/y', undefined).allowsCrawling).toBe(
			true,
		);
	});

	it('answers a named agent by its product token', () => {
		const answer = document.evaluate('/', 'MyBot/1.0');
		expect(answer.agent).toBe('mybot');
		expect(answer.allowsCrawling).toBe(false);
		expect(answer.sitemaps).toEqual(['https://e.com/s.xml']);
	});

	it('assumes complete disallow when the rules could not be read', () => {
		const answer = unreachableRobots().evaluate('/anything', undefined);
		expect(answer.exists).toBe(false);
		expect(answer.allowsCrawling).toBe(false);
	});
});

describe('toml and signatures', () => {
	it('reads the shapes a signature file takes', () => {
		const document = parseToml(
			'# c\nkey = "a"\nlabel = \'b\'\nlist = ["x", "y",]\nn = 1_000\nf = 1.5\nyes = true\n[t]\ninline = { k = "v" }\n[[arr]]\nz = """\nmulti\\\n  line"""\n[[arr]]\nz = \'\'\'raw\'\'\'\n',
		);
		expect(document).toMatchObject({
			key: 'a',
			label: 'b',
			list: ['x', 'y'],
			n: 1000,
			f: 1.5,
			yes: true,
			t: { inline: { k: 'v' } },
			arr: [{ z: 'multiline' }, { z: 'raw' }],
		});
		expect(() => parseToml('key = \n')).toThrow(/TOML parse error at line 1/);
		expect(() => parseToml('a = 1\na = 2\n')).toThrow(/duplicate key/);
		expect(() => parseToml('d = 1979-05-27\n')).toThrow();
	});

	it('replaces a built-in by key and extends with a new one', () => {
		const extra = parseExtra(
			'[[signature]]\nkey = "cloudflare"\nlabel = "Patched"\n\n[[signature]]\nkey = "kasada"\nlabel = "Kasada"\nglobals = ["KPSDK"]\n',
		);
		const merged = merge(BUILT_IN, extra);
		expect(merged).toHaveLength(BUILT_IN.length + 1);
		expect(merged[0]?.label).toBe('Patched');
		expect(parseExtra('key = "one"\nlabel = "One"\n')).toHaveLength(1);
		expect(() => parseExtra('label = "x"\n')).toThrow('missing field `key`');
		expect(() => parseExtra('key = "a"\nlabel = 5\n')).toThrow('invalid type');
	});

	it('refuses a file it cannot read as a regular file', () => {
		const missing = loadExtra('/no/such/file.toml');
		expect(missing.ok).toBe(false);
		expect(loadExtra('.')).toEqual({
			ok: false,
			message: 'could not read .: not a regular file',
		});
	});
});

describe('http uri', () => {
	it('reads a URL the way the http crate does', () => {
		const parsed = parseHttpUri('HTTP://a.com?q#frag');
		expect(parsed.ok && displayUri(parsed.uri)).toBe('http://a.com/?q');
		expect(parseHttpUri('http://a.com/a b')).toEqual({
			ok: false,
			message: 'invalid uri character',
		});
		const bare = parseHttpUri('example.invalid');
		expect(bare.ok && refusedUri(bare.uri)).toBe(
			'example.invalid is missing scheme',
		);
		const ftp = parseHttpUri('ftp://x');
		expect(ftp.ok && refusedUri(ftp.uri)).toBe('unknown scheme: ftp');
		expect(parseHttpUri('http://a:1:2/').ok).toBe(false);
		expect(parseHttpUri('').ok).toBe(false);
	});

	it('joins a Location the way ureq-proto does', () => {
		const base = parseHttpUri('http://a.com/x/y/z');
		if (!base.ok) throw new Error('base');
		const join = (location: string) => {
			const joined = joinLocation(base.uri, location);
			return typeof joined === 'string' ? joined : displayUri(joined);
		};
		expect(join('../w?q=1')).toBe('http://a.com/x/w?q=1');
		expect(join('/root')).toBe('http://a.com/root');
		expect(join('//b.com/p')).toBe('http://b.com/p');
		expect(join('https://c.com')).toBe('https://c.com/');
		expect(join('../../../../up')).toBe(
			'location header is malformed: ../../../../up',
		);
	});
});

describe('net errors', () => {
	const error = (code: string) => Object.assign(new Error(code), { code });

	it('words a failure as the platform does', () => {
		expect(rustNetMessage(error('ECONNREFUSED'), 'darwin')).toBe(
			'Connection refused (os error 61)',
		);
		expect(rustNetMessage(error('ECONNREFUSED'), 'linux')).toBe(
			'Connection refused (os error 111)',
		);
		expect(rustNetMessage(error('ECONNREFUSED'), 'win32')).toBe(
			'No connection could be made because the target machine actively refused it. (os error 10061)',
		);
		expect(rustNetMessage(error('ENOTFOUND'), 'linux')).toBe(
			'failed to lookup address information: Name or service not known',
		);
		expect(rustNetMessage(error('ENOTFOUND'), 'win32')).toBe(
			'No such host is known. (os error 11001)',
		);
	});
});

describe('batch', () => {
	it('reads input by content', () => {
		expect(parseInput('﻿["https://a.com", {"url": "https://b.com"}]')).toEqual([
			'https://a.com',
			'https://b.com',
		]);
		expect(parseInput('note,url\nx,"https://a.com"\ny,\n')).toEqual([
			'https://a.com',
		]);
		expect(parseInput('# c\nhttps://a.com\r\n\nhttps://b.com,extra\n')).toEqual(
			['https://a.com', 'https://b.com'],
		);
		expect(() => parseInput('[{"link": 1}]')).toThrow(
			'entry 0 has no `url` key',
		);
		expect(() => parseInput('[1]')).toThrow(
			'entry 0 is neither a string nor an object',
		);
		expect(() => parseInput('[')).toThrow(/^input is not valid JSON: /);
	});

	it('groups by host and caps an absurd delay', () => {
		const groups = groupByHost([
			{ index: 0, url: 'https://A.com/1' },
			{ index: 1, url: 'https://b.com/1' },
			{ index: 2, url: 'https://a.com/2' },
			{ index: 3, url: 'not a url' },
		]);
		expect(groups.map((g) => g.map((t) => t.index))).toEqual([
			[0, 2],
			[1],
			[3],
		]);
		expect(waitFor(Number.POSITIVE_INFINITY)).toBeUndefined();
		expect(waitFor(0)).toBeUndefined();
		expect(waitFor(1e18)).toBe(300_000);
		expect(waitFor(0.5)).toBe(500);
	});

	it('runs one host at a time, last host first, and checks a duplicate once', async () => {
		const order: number[] = [];
		let calls = 0;
		const summary = await runBatch(
			[
				{ index: 0, url: 'https://a.com/x' },
				{ index: 1, url: 'https://b.com/x' },
				{ index: 2, url: 'https://a.com/x' },
			],
			{ concurrency: 1, ignoreCrawlDelay: true },
			async (target) => {
				calls += 1;
				return blockedReport(target.url, 'no', target.index, true);
			},
			(report) => order.push(report.index ?? -1),
		);
		expect(order).toEqual([1, 0, 2]);
		expect(calls).toBe(2);
		expect(summary.blocked).toBe(3);
	});
});

describe('report', () => {
	it('reads a raw title by ASCII case', () => {
		expect(extractTitle('<HTML><TITLE> Hi </TITLE>')).toBe('Hi');
		expect(extractTitle('<title>  </title>')).toBeUndefined();
		expect(extractTitle('İ<title>Kept</title>')).toBe('Kept');
		expect(extractTitle('no title')).toBeUndefined();
	});

	it('needs completeness for clear and none for restricted', () => {
		const evidence = {
			url: 'https://a.com/login',
			finalUrl: 'https://a.com/login',
			status: 401,
			headers: new Map([
				['cf-ray', 'x'],
				['retry-after', '5'],
			]),
			bodyHtml: '',
			robots: parseRobots('User-agent: *\nDisallow: /login\n'),
			render: undefined,
			fetchMs: 1,
			totalMs: 2,
		};
		const report = check(
			evidence,
			{ agent: undefined, index: undefined, ignoreCrawlDelay: false },
			BUILT_IN,
		);
		expect(report.verdict).toBe('restricted');
		expect(report.findings.map((f) => f.kind)).toEqual([
			'antibot',
			'rate_limit',
			'robots',
			'auth',
		]);
		expect(report.checks_skipped).toEqual(['antibot', 'auth']);
		const clean = check(
			{
				...evidence,
				status: 200,
				headers: new Map(),
				robots: undefined,
				url: 'https://a.com/',
				finalUrl: 'https://a.com/',
			},
			{ agent: undefined, index: undefined, ignoreCrawlDelay: false },
			BUILT_IN,
		);
		expect(clean.verdict).toBe('inconclusive');
	});

	it('projects a report onto stderr', () => {
		const report: Report = {
			...blockedReport('https://a.com', 'refused', 3, false),
			robots: {
				exists: true,
				allows_crawling: true,
				agent: '*',
				crawl_delay: float(1.5),
				disallowed_paths: [],
				sitemaps: [],
			},
			screenshot: './shot.png',
		};
		const text = human(report);
		expect(text).toContain(
			'[3] blocked — 1 finding  (https://a.com · 0ms · exit 1)',
		);
		expect(text).toContain('  blocks  fetch      refused');
		expect(text).toContain('  robots  Crawl-delay: 1.5s (User-agent: *)');
		expect(text).toContain('  shot    ./shot.png');
		expect(text).not.toContain('note');
	});
});

describe('arguments', () => {
	const io = { stderr: () => undefined, version: '9.9.9' };

	it('answers help and version before anything later', () => {
		expect(parseArgs(['--bogus', '--help'], io)).toMatchObject({
			kind: 'error',
		});
		expect(parseArgs(['x', '--version', '--bogus'], io)).toEqual({
			kind: 'message',
			text: 'scrape-le 9.9.9',
		});
	});

	it('reads a count as usize does', () => {
		expect(parseArgs(['--concurrency', '+2'], io)).toMatchObject({
			options: { concurrency: 2 },
		});
		expect(parseArgs(['--concurrency', '0'], io)).toEqual({
			kind: 'error',
			text: '--concurrency must be at least 1',
		});
		expect(parseArgs(['--concurrency', '-1'], io)).toEqual({
			kind: 'error',
			text: '--concurrency needs a number, got -1',
		});
		expect(parseArgs(['--agent'], io)).toEqual({
			kind: 'error',
			text: '--agent needs a value',
		});
	});
});

describe('against a loopback server', () => {
	let server: Server;
	let base = '';

	beforeAll(async () => {
		server = createServer((request, response) => {
			if (request.url === '/robots.txt') {
				response.writeHead(200, { 'content-type': 'text/plain' });
				response.end('User-agent: *\nDisallow: /private\nCrawl-delay: 0.01\n');
				return;
			}
			if (request.url === '/redirect') {
				response.writeHead(302, { location: '/page' });
				response.end();
				return;
			}
			if (request.url === '/loop') {
				response.writeHead(302, { location: '/loop' });
				response.end();
				return;
			}
			if (request.url === '/close') {
				request.socket.destroy();
				return;
			}
			response.writeHead(200, {
				'content-type': 'text/html',
				'x-ratelimit-limit': '10',
				'transfer-encoding': 'chunked',
			});
			response.write('<title>Lo');
			response.end('op</title>');
		});
		await new Promise<void>((resolve) =>
			server.listen(0, '127.0.0.1', resolve),
		);
		base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	});

	afterAll(() => {
		server.close();
	});

	it('follows redirects and reads a chunked body', async () => {
		const result = await httpGet(`${base}/redirect`, '0.0.0');
		expect(result.ok && result.response.finalUrl).toBe(`${base}/page`);
		expect(result.ok && result.response.body).toBe('<title>Loop</title>');
		const loop = await httpGet(`${base}/loop`, '0.0.0');
		expect(loop).toMatchObject({
			ok: false,
			failure: { message: 'too many redirects' },
		});
		const closed = await httpGet(`${base}/close`, '0.0.0');
		expect(closed).toMatchObject({
			ok: false,
			failure: { message: 'Peer disconnected' },
		});
	});

	it('holds a served robots.txt for the run', async () => {
		const robots = createRobotsCache('0.0.0');
		const first = await robots.document(`${base}/a`);
		expect(await robots.document(`${base}/b`)).toBe(first);
		const fetched = await fetchEvidence(`${base}/private/x`, robots, '0.0.0');
		expect(fetched.ok && fetched.evidence.status).toBe(200);
	});

	it('checks a URL end to end and exits 1 when it is not a yes', async () => {
		let stdout = '';
		let stderr = '';
		const code = await run(['--no-render', `${base}/private/x`], {
			stdout: (text) => {
				stdout += text;
			},
			stderr: (text) => {
				stderr += text;
			},
			stdoutIsTerminal: false,
			readStdin: () => new Uint8Array(),
			version: '0.0.0',
		});
		expect(code).toBe(1);
		expect(
			JSON.parse(stdout).findings.map((f: { kind: string }) => f.kind),
		).toContain('robots');
		expect(stderr).toContain('Disallow: /private for User-agent: *');
	});

	it('runs a batch from stdin', async () => {
		let stderr = '';
		const code = await run(['--no-render', '--input', '-'], {
			stdout: () => undefined,
			stderr: (text) => {
				stderr += text;
			},
			stdoutIsTerminal: true,
			readStdin: () => Buffer.from(`${base}/page\nftp://x\n`),
			version: '0.0.0',
		});
		expect(code).toBe(2);
		expect(stderr).toContain(
			'scrape-le: entry 1 is not an http(s) URL: ftp://x',
		);
		expect(stderr).toContain('1 URLs across 1 host(s) in ');
	});

	it('serves the crate tools over MCP, keys sorted', async () => {
		const lines: string[] = [];
		const requests = [
			{ jsonrpc: '2.0', id: 1, method: 'initialize' },
			{ jsonrpc: '2.0', method: 'notifications/initialized' },
			{ jsonrpc: '2.0', id: 2, method: 'nope' },
			{
				jsonrpc: '2.0',
				id: 3,
				method: 'tools/call',
				params: {
					name: 'analyze_robots_txt',
					arguments: {
						content: 'User-agent: *\nCrawl-delay: 1e21\n',
						path: 'x',
					},
				},
			},
			{
				jsonrpc: '2.0',
				id: 4,
				method: 'tools/call',
				params: {
					name: 'scrape_le_check',
					arguments: { url: `${base}/page`, render: false },
				},
			},
			{
				jsonrpc: '2.0',
				id: 5,
				method: 'tools/call',
				params: { name: 'scrape_le_check' },
			},
		];
		await serve(
			{ version: '0.0.0', signatures: BUILT_IN, stderr: () => undefined },
			Readable.from([
				Buffer.from(
					['', 'not json', ...requests.map((r) => JSON.stringify(r)), ''].join(
						'\n',
					),
				),
			]),
			(line) => lines.push(line),
		);
		expect(lines).toHaveLength(5);
		expect(lines[0]).toBe(
			'{"id":1,"jsonrpc":"2.0","result":{"capabilities":{"tools":{}},"protocolVersion":"2025-06-18","serverInfo":{"name":"scrape-le","version":"0.0.0"}}}\n',
		);
		expect(lines[1]).toContain(
			'"message":"this server does not implement nope"',
		);
		expect(lines[2]).toContain('"crawlDelay":9223372036854775807');
		expect(lines[2]).toContain('has no leading slash and no scheme');
		expect(lines[3]).toContain('"verdict":"restricted"');
		expect(lines[4]).toContain('"isError":true');
	});
});

describe('browser discovery', () => {
	it('honours CHROME and names it when it is wrong', () => {
		expect(findBrowser({ CHROME: '/no/such/chrome' }, 'linux')).toEqual({
			ok: false,
			reason: 'CHROME points at /no/such/chrome, which does not exist',
		});
		expect(findBrowser({ CHROME: process.execPath }, 'linux')).toEqual({
			ok: true,
			path: process.execPath,
		});
	});
});
