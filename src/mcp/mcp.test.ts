import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { capped, isOk, note, readMaxResults } from './envelope';
import { TOOLS } from './tools';
import { createResponder, serve } from './transport';

/**
 * The MCP layer: the normalisation boundary, the tool table and the protocol.
 *
 * The engine is covered by its own tests. What is new here is that a full URL
 * has to be reduced to a path before the rules can match it — matching
 * `https://example.com/admin` against `Disallow: /admin` never matches and
 * reports everything as allowed, which is the dangerous direction to be wrong
 * in — and that a disallowed path is an answer rather than a failure.
 */

const ROBOTS = [
	'User-agent: *',
	'Disallow: /admin',
	'Disallow: /private',
	'Crawl-delay: 5',
	'Sitemap: https://example.com/sitemap.xml',
].join('\n');

const call = async (args: Record<string, unknown>) => {
	const tool = TOOLS[0];
	if (!tool) throw new Error('no tool');
	return (await tool.handler(args)) as {
		ok: boolean;
		data: {
			path: string;
			allowsCrawling: boolean;
			crawlDelay?: number;
			disallowedPaths: string[];
			sitemaps: string[];
		};
		diagnostics: { message: string }[];
		meta: { count: number; truncated: boolean };
	};
};

describe('analyze_robots_txt', () => {
	it('refuses a disallowed path', async () => {
		const result = await call({ content: ROBOTS, path: '/admin' });
		expect(result.data.allowsCrawling).toBe(false);
	});

	it('permits a path no rule covers', async () => {
		const result = await call({ content: ROBOTS, path: '/blog' });
		expect(result.data.allowsCrawling).toBe(true);
	});

	it('reduces a full URL to its path before matching', async () => {
		// The bug this exists to prevent: matching the whole URL against
		// `Disallow: /admin` never matches, so everything reads as allowed.
		const result = await call({
			content: ROBOTS,
			path: 'https://example.com/admin',
		});
		expect(result.data.path).toBe('/admin');
		expect(result.data.allowsCrawling).toBe(false);
	});

	it('carries the crawl delay and sitemaps through', async () => {
		const result = await call({ content: ROBOTS, path: '/blog' });
		expect(result.data.crawlDelay).toBe(5);
		expect(result.data.sitemaps).toContain('https://example.com/sitemap.xml');
	});

	it('says so when the target was neither a path nor a URL', async () => {
		// Guessing silently would be worse than guessing loudly.
		const result = await call({ content: ROBOTS, path: 'admin' });
		expect(result.data.path).toBe('/admin');
		expect(result.diagnostics.length).toBeGreaterThan(0);
	});

	it('is ok even when crawling is refused', async () => {
		// Disallowed is the answer, not a failure to produce one.
		const result = await call({ content: ROBOTS, path: '/admin' });
		expect(result.ok).toBe(true);
	});

	it('truncates the disallowed list and says so', async () => {
		const many = [
			'User-agent: *',
			...Array.from({ length: 10 }, (_, i) => `Disallow: /p${i}`),
		].join('\n');
		const result = await call({ content: many, path: '/ok', maxResults: 3 });
		expect(result.data.disallowedPaths).toHaveLength(3);
		expect(result.meta.truncated).toBe(true);
	});

	it('requires content and a path', async () => {
		await expect(call({ path: '/x' })).rejects.toThrow(/content is required/);
		await expect(call({ content: ROBOTS })).rejects.toThrow(/path is required/);
	});
});

describe('envelope', () => {
	it('is ok when nothing was noted', () => {
		expect(isOk([])).toBe(true);
	});

	it('treats a note as a warning that does not invalidate the verdict', () => {
		expect(isOk([note('treated as a path')])).toBe(true);
	});

	it('reports truncation honestly when it drops items', () => {
		const { items, truncated } = capped([1, 2, 3, 4, 5], 2);
		expect(items).toEqual([1, 2]);
		expect(truncated).toBe(true);
	});

	it('rejects a maxResults a tool cannot honour', () => {
		expect(() => readMaxResults({ maxResults: 0 })).toThrow(/positive integer/);
		expect(() => readMaxResults({ maxResults: 1.5 })).toThrow();
	});

	it('clamps an oversized request rather than refusing it', () => {
		expect(readMaxResults({ maxResults: 999999 })).toBe(5000);
	});
});

describe('tool table', () => {
	it('pins the tool names', () => {
		expect(TOOLS.map((t) => t.name)).toEqual(['analyze_robots_txt']);
	});

	it('exposes nothing that reaches the network', () => {
		// fetchRobotsTxt builds a URL from an arbitrary origin, so inside an agent
		// loop it is an SSRF primitive. No tool here may take a URL to fetch.
		for (const tool of TOOLS) {
			const schema = tool.inputSchema as {
				properties: Record<string, unknown>;
			};
			expect(Object.keys(schema.properties)).not.toContain('url');
			expect(tool.description).toMatch(/no network request/i);
		}
	});

	it('gives every tool a description and a closed schema', () => {
		for (const tool of TOOLS) {
			expect(tool.description.length).toBeGreaterThan(20);
			expect(tool.inputSchema.type).toBe('object');
			expect(tool.inputSchema.additionalProperties).toBe(false);
			expect(typeof tool.handler).toBe('function');
		}
	});
});

describe('protocol', () => {
	const respond = createResponder(
		{ name: 'scrape-le', version: '1.0.0' },
		TOOLS,
	);

	it('echoes the protocol version the client asked for', async () => {
		const reply = await respond({
			jsonrpc: '2.0',
			id: 1,
			method: 'initialize',
			params: { protocolVersion: '2024-11-05' },
		});
		expect(reply?.result?.protocolVersion).toBe('2024-11-05');
		expect(reply?.result?.serverInfo).toEqual({
			name: 'scrape-le',
			version: '1.0.0',
		});
	});

	it('does not reply to a notification', async () => {
		// A reply to a notification is the classic way to wedge a client.
		expect(
			await respond({ jsonrpc: '2.0', method: 'notifications/initialized' }),
		).toBeNull();
	});

	it('reports an unknown method as a JSON-RPC error', async () => {
		const reply = await respond({ jsonrpc: '2.0', id: 2, method: 'nope' });
		expect(reply?.error?.code).toBe(-32601);
	});

	it('reports an unknown tool without killing the connection', async () => {
		const reply = await respond({
			jsonrpc: '2.0',
			id: 3,
			method: 'tools/call',
			params: { name: 'no_such_tool', arguments: {} },
		});
		expect(reply?.error?.code).toBe(-32602);
	});

	it('returns a tool failure as a result, not a protocol error', async () => {
		// A model can read an isError result and correct itself; a JSON-RPC error
		// reads as "the server is broken".
		const reply = await respond({
			jsonrpc: '2.0',
			id: 4,
			method: 'tools/call',
			params: { name: 'analyze_robots_txt', arguments: {} },
		});
		expect(reply?.error).toBeUndefined();
		expect(reply?.result?.isError).toBe(true);
	});
});

describe('serve: the stdio loop', () => {
	/** A fake stdin/stdout pair so the loop can be driven without a process. */
	function harness() {
		const input = new EventEmitter() as EventEmitter & {
			setEncoding?: (e: string) => void;
		};
		const written: string[] = [];
		const output = {
			write: (chunk: string) => {
				written.push(chunk);
				return true;
			},
		};
		serve(
			{ name: 'scrape-le', version: '1.0.0' },
			TOOLS,
			input as never,
			output as never,
		);
		const replies = () =>
			written
				.join('')
				.split('\n')
				.filter(Boolean)
				.map((l) => JSON.parse(l));
		return { input, replies };
	}

	const settle = () => new Promise((r) => setTimeout(r, 20));

	it('answers a request delivered as one line', async () => {
		const { input, replies } = harness();
		input.emit('data', '{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n');
		await settle();
		expect(replies()[0]?.result?.tools).toHaveLength(1);
	});

	it('reassembles a request split across chunks', async () => {
		// stdin delivers whatever the OS gives it; a request arriving in two
		// pieces must not be dropped or double-parsed.
		const { input, replies } = harness();
		input.emit('data', '{"jsonrpc":"2.0","id":2,"me');
		input.emit('data', 'thod":"ping"}\n');
		await settle();
		expect(replies()[0]?.id).toBe(2);
	});

	it('handles several requests in one chunk', async () => {
		const { input, replies } = harness();
		input.emit(
			'data',
			'{"jsonrpc":"2.0","id":3,"method":"ping"}\n{"jsonrpc":"2.0","id":4,"method":"ping"}\n',
		);
		await settle();
		expect(replies().map((r) => r.id)).toEqual([3, 4]);
	});

	it('reports malformed JSON without dying', async () => {
		// One bad line from a client must not take the server down for everyone.
		const { input, replies } = harness();
		input.emit('data', 'not json at all\n');
		input.emit('data', '{"jsonrpc":"2.0","id":5,"method":"ping"}\n');
		await settle();
		expect(replies()[0]?.error?.code).toBe(-32700);
		expect(replies()[1]?.id).toBe(5);
	});

	it('rejects a payload that is not a JSON-RPC request', async () => {
		const { input, replies } = harness();
		input.emit('data', '{"hello":"world"}\n');
		await settle();
		expect(replies()[0]?.error?.code).toBe(-32700);
	});

	it('ignores blank lines', async () => {
		const { input, replies } = harness();
		input.emit('data', '\n\n{"jsonrpc":"2.0","id":6,"method":"ping"}\n');
		await settle();
		expect(replies()).toHaveLength(1);
	});

	it('writes nothing for a notification', async () => {
		const { input, replies } = harness();
		input.emit(
			'data',
			'{"jsonrpc":"2.0","method":"notifications/initialized"}\n',
		);
		await settle();
		expect(replies()).toHaveLength(0);
	});
});
