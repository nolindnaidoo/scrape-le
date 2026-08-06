/**
 * Fails when the extension's in-code detection data drifts from the shared
 * corpus at the repo root, which the Rust CLI (crate/) also builds against.
 *
 * - signatures/*.toml must equal ANTI_BOT_SIGNATURES exactly, both ways:
 *   every vendor in code has a file, every file matches the code.
 * - fixtures/ cases must reproduce under the extension's own functions
 *   (matchHeaders, parseRobotsTxt, validateUrl/normalizeUrl/extractUrl).
 *   A case's `divergence` field documents the CLI's differing answer and
 *   is deliberately not evaluated here.
 *
 * Run: bun scripts/check-signature-parity.ts
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
	ANTI_BOT_SIGNATURES,
	matchHeaders,
} from '../src/detectors/heuristics';
import { parseRobotsTxt } from '../src/detectors/robotstxt';
import { TOOLS } from '../src/mcp/tools';
import { extractUrl, normalizeUrl, validateUrl } from '../src/utils/url';

const ROOT = join(import.meta.dir, '..');
const failures: string[] = [];

function fail(message: string): void {
	failures.push(message);
}

function deepEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (Array.isArray(a) && Array.isArray(b)) {
		if (a.length !== b.length) return false;
		return a.every((item, i) => deepEqual(item, b[i]));
	}
	if (typeof a !== 'object' || typeof b !== 'object') return false;
	if (a === null || b === null) return false;
	const keysA = Object.keys(a).sort();
	const keysB = Object.keys(b).sort();
	if (!deepEqual(keysA, keysB)) return false;
	return keysA.every((key) =>
		deepEqual(
			(a as Record<string, unknown>)[key],
			(b as Record<string, unknown>)[key],
		),
	);
}

/** Drops `undefined` fields so results compare cleanly against plain JSON. */
function asJson(value: unknown): unknown {
	return JSON.parse(JSON.stringify(value));
}

async function checkSignatures(): Promise<void> {
	const dir = join(ROOT, 'signatures');
	const files = readdirSync(dir).filter((f) => f.endsWith('.toml'));
	const corpusKeys = files.map((f) => f.replace(/\.toml$/, '')).sort();
	const codeKeys = ANTI_BOT_SIGNATURES.map((s) => s.key).sort();
	if (!deepEqual(corpusKeys, codeKeys)) {
		fail(
			`signature vendor sets differ — corpus [${corpusKeys.join(', ')}] vs code [${codeKeys.join(', ')}]`,
		);
		return;
	}

	for (const signature of ANTI_BOT_SIGNATURES) {
		const { default: corpus } = await import(
			join(dir, `${signature.key}.toml`)
		);
		const fromCode = {
			key: signature.key,
			label: signature.label,
			script_substrings: [...signature.scriptSubstrings],
			selectors: [...signature.selectors],
			globals: [...signature.globals],
			headers: signature.headers.map((h) =>
				h.contains === undefined
					? { name: h.name }
					: { name: h.name, contains: h.contains },
			),
		};
		if (!deepEqual(asJson(corpus), fromCode)) {
			fail(
				`signatures/${signature.key}.toml drifted from ANTI_BOT_SIGNATURES:\n  corpus: ${JSON.stringify(corpus)}\n  code:   ${JSON.stringify(fromCode)}`,
			);
		}
	}
}

function checkAntibotFixtures(): void {
	const cases = JSON.parse(
		readFileSync(join(ROOT, 'fixtures', 'antibot-headers.json'), 'utf8'),
	);
	for (const testCase of cases) {
		for (const signature of ANTI_BOT_SIGNATURES) {
			const actual = matchHeaders(testCase.headers, signature);
			const expected = testCase.expected[signature.key];
			if (actual !== expected) {
				fail(
					`antibot "${testCase.name}" [${signature.key}]: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
				);
			}
		}
	}
}

function checkRobotsFixtures(): void {
	const dir = join(ROOT, 'fixtures', 'robots');
	const cases = JSON.parse(readFileSync(join(dir, 'cases.json'), 'utf8'));
	for (const testCase of cases) {
		const body = readFileSync(join(dir, testCase.file), 'utf8');
		const actual = asJson(parseRobotsTxt(body, testCase.path));
		if (!deepEqual(actual, testCase.expected)) {
			fail(
				`robots "${testCase.name}": expected ${JSON.stringify(testCase.expected)}, got ${JSON.stringify(actual)}`,
			);
		}
	}
}

function checkUrlFixtures(): void {
	const cases = JSON.parse(
		readFileSync(join(ROOT, 'fixtures', 'url.json'), 'utf8'),
	);
	const runners: Readonly<Record<string, (input: string) => unknown>> = {
		validate: validateUrl,
		normalize: normalizeUrl,
		extract: extractUrl,
	};
	for (const [section, run] of Object.entries(runners)) {
		for (const testCase of cases[section]) {
			const actual = run(testCase.input);
			if (actual !== testCase.expected) {
				fail(
					`url ${section} ${JSON.stringify(testCase.input)}: expected ${JSON.stringify(testCase.expected)}, got ${JSON.stringify(actual)}`,
				);
			}
		}
	}
}

/**
 * `analyze_robots_txt` is offered by BOTH MCP servers — this one, which
 * ships on npm and inside the extension, and the Rust CLI's. They are
 * meant to be the same tool, not two similar ones, so the same corpus
 * runs against both: this function here, and
 * `crate/src/mcp/analyze.rs`'s own test there. A drift in either
 * direction fails a build.
 */
async function checkMcpAnalyzeFixtures(): Promise<void> {
	const cases = JSON.parse(
		readFileSync(join(ROOT, 'fixtures', 'mcp-analyze-robots.json'), 'utf8'),
	);
	const tool = TOOLS.find((t) => t.name === 'analyze_robots_txt');
	if (!tool) {
		fail('the extension no longer offers analyze_robots_txt');
		return;
	}

	for (const testCase of cases) {
		const args = { ...testCase.arguments };
		if (testCase.file) {
			args.content = readFileSync(
				join(ROOT, 'fixtures', 'robots', testCase.file),
				'utf8',
			);
		}

		if (testCase.expectedError) {
			try {
				await tool.handler(args);
				fail(
					`mcp analyze "${testCase.name}": expected it to fail with ${JSON.stringify(testCase.expectedError)}`,
				);
			} catch (error) {
				const message =
					error instanceof Error ? error.message : String(error);
				if (message !== testCase.expectedError) {
					fail(
						`mcp analyze "${testCase.name}": expected error ${JSON.stringify(testCase.expectedError)}, got ${JSON.stringify(message)}`,
					);
				}
			}
			continue;
		}

		const actual = asJson(await tool.handler(args));
		if (!deepEqual(actual, testCase.expected)) {
			fail(
				`mcp analyze "${testCase.name}":\n  expected: ${JSON.stringify(testCase.expected)}\n  got:      ${JSON.stringify(actual)}`,
			);
		}
	}
}

await checkSignatures();
checkAntibotFixtures();
checkRobotsFixtures();
checkUrlFixtures();
await checkMcpAnalyzeFixtures();

if (failures.length > 0) {
	console.error(`Signature/fixture parity FAILED (${failures.length}):\n`);
	for (const failure of failures) {
		console.error(`- ${failure}\n`);
	}
	process.exit(1);
}
console.log(
	'OK: signatures/*.toml match ANTI_BOT_SIGNATURES and all fixture cases reproduce under the extension.',
);
