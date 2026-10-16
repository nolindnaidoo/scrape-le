/**
 * The TOML a `--signatures` file is written in.
 *
 * Enough of TOML 1.0 for a table of strings and arrays: comments, bare, quoted
 * and dotted keys, the four string forms, numbers, booleans, arrays, inline
 * tables, `[table]` and `[[array of tables]]`. A date or time is refused rather
 * than read wrong, since no signature field holds one.
 *
 * What a malformed file is told differs from the crate's wording: the `toml`
 * crate draws the offending line with a caret, and that rendering is not
 * reproduced. Which files are refused is the same, and
 * `scripts/check-cli-parity.ts` holds the exit code and the prefix equal.
 */

export type TomlValue =
	| string
	| number
	| boolean
	| readonly TomlValue[]
	| { [key: string]: TomlValue };

type Table = { [key: string]: TomlValue };

type Cursor = { readonly text: string; index: number };

function isDone(cursor: Cursor): boolean {
	return cursor.index >= cursor.text.length;
}

function peek(cursor: Cursor, offset = 0): string {
	return cursor.text[cursor.index + offset] ?? '';
}

function startsWith(cursor: Cursor, token: string): boolean {
	return cursor.text.startsWith(token, cursor.index);
}

function fail(cursor: Cursor, message: string): never {
	const before = cursor.text.slice(0, cursor.index);
	const line = before.split('\n').length;
	const column = cursor.index - before.lastIndexOf('\n');
	throw new Error(
		`TOML parse error at line ${line}, column ${column}\n${message}`,
	);
}

export function parseToml(text: string): Table {
	const cursor: Cursor = { text, index: 0 };
	const root: Table = {};
	let current = root;
	// Tables a header has defined, which may not be defined twice.
	const defined = new Set<Table>();

	while (true) {
		skipBlank(cursor);
		if (isDone(cursor)) return root;
		if (startsWith(cursor, '[[')) {
			cursor.index += 2;
			const path = readKeyPath(cursor);
			expect(cursor, ']]');
			endOfLine(cursor);
			current = appendTable(root, path, cursor);
			continue;
		}
		if (peek(cursor) === '[') {
			cursor.index += 1;
			const path = readKeyPath(cursor);
			expect(cursor, ']');
			endOfLine(cursor);
			current = openTable(root, path, cursor);
			if (defined.has(current)) fail(cursor, 'duplicate key');
			defined.add(current);
			continue;
		}
		readPair(cursor, current);
		endOfLine(cursor);
	}
}

/** No line of the corpus is a whole statement without one. */
function skipBlank(cursor: Cursor): void {
	while (!isDone(cursor)) {
		const char = peek(cursor);
		if (char === ' ' || char === '\t' || char === '\n') {
			cursor.index += 1;
			continue;
		}
		if (char === '\r' && peek(cursor, 1) === '\n') {
			cursor.index += 2;
			continue;
		}
		if (char === '#') {
			skipComment(cursor);
			continue;
		}
		return;
	}
}

function skipSpace(cursor: Cursor): void {
	while (peek(cursor) === ' ' || peek(cursor) === '\t') cursor.index += 1;
}

function skipComment(cursor: Cursor): void {
	while (!isDone(cursor) && peek(cursor) !== '\n') {
		const code = cursor.text.charCodeAt(cursor.index);
		if ((code < 0x20 && code !== 0x09 && code !== 0x0d) || code === 0x7f) {
			fail(cursor, 'invalid comment character');
		}
		cursor.index += 1;
	}
}

function endOfLine(cursor: Cursor): void {
	skipSpace(cursor);
	if (peek(cursor) === '#') skipComment(cursor);
	if (isDone(cursor)) return;
	if (peek(cursor) === '\n') {
		cursor.index += 1;
		return;
	}
	if (startsWith(cursor, '\r\n')) {
		cursor.index += 2;
		return;
	}
	fail(cursor, 'expected newline, `#`');
}

function expect(cursor: Cursor, token: string): void {
	skipSpace(cursor);
	if (!startsWith(cursor, token)) fail(cursor, `expected \`${token}\``);
	cursor.index += token.length;
}

function readKeyPath(cursor: Cursor): string[] {
	const path: string[] = [];
	while (true) {
		skipSpace(cursor);
		path.push(readKey(cursor));
		skipSpace(cursor);
		if (peek(cursor) !== '.') return path;
		cursor.index += 1;
	}
}

function readKey(cursor: Cursor): string {
	if (peek(cursor) === '"') return readBasic(cursor);
	if (peek(cursor) === "'") return readLiteral(cursor);
	const start = cursor.index;
	while (/[A-Za-z0-9_-]/.test(peek(cursor))) cursor.index += 1;
	if (cursor.index === start) fail(cursor, 'invalid key');
	return cursor.text.slice(start, cursor.index);
}

function readPair(cursor: Cursor, table: Table): void {
	const path = readKeyPath(cursor);
	expect(cursor, '=');
	skipSpace(cursor);
	const value = readValue(cursor);
	const last = path[path.length - 1] as string;
	const parent = descend(table, path.slice(0, -1), cursor);
	if (Object.hasOwn(parent, last)) fail(cursor, 'duplicate key');
	parent[last] = value;
}

function descend(table: Table, path: readonly string[], cursor: Cursor): Table {
	let current = table;
	for (const key of path) {
		const next = current[key];
		if (next === undefined) {
			const created: Table = {};
			current[key] = created;
			current = created;
			continue;
		}
		if (!isTable(next)) fail(cursor, 'duplicate key');
		current = next;
	}
	return current;
}

function openTable(
	root: Table,
	path: readonly string[],
	cursor: Cursor,
): Table {
	let current = root;
	for (const key of path) {
		const next = current[key];
		if (next === undefined) {
			const created: Table = {};
			current[key] = created;
			current = created;
			continue;
		}
		if (Array.isArray(next)) {
			const last = next[next.length - 1];
			if (!isTable(last)) fail(cursor, 'duplicate key');
			current = last;
			continue;
		}
		if (!isTable(next)) fail(cursor, 'duplicate key');
		current = next;
	}
	return current;
}

function appendTable(
	root: Table,
	path: readonly string[],
	cursor: Cursor,
): Table {
	const parent = openTable(root, path.slice(0, -1), cursor);
	const last = path[path.length - 1] as string;
	const created: Table = {};
	const existing = parent[last];
	if (existing === undefined) {
		parent[last] = [created];
		return created;
	}
	if (!Array.isArray(existing)) fail(cursor, 'duplicate key');
	(existing as TomlValue[]).push(created);
	return created;
}

function isTable(value: TomlValue | undefined): value is Table {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readValue(cursor: Cursor): TomlValue {
	const char = peek(cursor);
	if (startsWith(cursor, '"""')) return readMultiBasic(cursor);
	if (startsWith(cursor, "'''")) return readMultiLiteral(cursor);
	if (char === '"') return readBasic(cursor);
	if (char === "'") return readLiteral(cursor);
	if (char === '[') return readArray(cursor);
	if (char === '{') return readInline(cursor);
	if (startsWith(cursor, 'true')) {
		cursor.index += 4;
		return true;
	}
	if (startsWith(cursor, 'false')) {
		cursor.index += 5;
		return false;
	}
	return readNumber(cursor);
}

function readNumber(cursor: Cursor): number {
	const match =
		/^[+-]?(?:inf|nan|0x[0-9A-Fa-f_]+|0o[0-7_]+|0b[01_]+|[0-9_]+(?:\.[0-9_]+)?(?:[eE][+-]?[0-9_]+)?)/.exec(
			cursor.text.slice(cursor.index),
		);
	if (!match || match[0] === '' || /^[+-]?$/.test(match[0])) {
		fail(cursor, 'invalid string\nexpected `"`, `\'`');
	}
	const raw = match[0];
	if (/^[0-9]{4}-/.test(cursor.text.slice(cursor.index))) {
		fail(cursor, 'dates and times are not signature values');
	}
	cursor.index += raw.length;
	const clean = raw.replace(/_/g, '');
	if (/inf$/.test(clean)) {
		return clean.startsWith('-')
			? Number.NEGATIVE_INFINITY
			: Number.POSITIVE_INFINITY;
	}
	if (/nan$/.test(clean)) return Number.NaN;
	if (/^[+-]?0[xob]/.test(clean)) return Number(clean.replace(/^\+/, ''));
	return Number(clean);
}

function readArray(cursor: Cursor): TomlValue[] {
	cursor.index += 1;
	const items: TomlValue[] = [];
	while (true) {
		skipBlank(cursor);
		if (peek(cursor) === ']') {
			cursor.index += 1;
			return items;
		}
		if (isDone(cursor)) fail(cursor, 'unclosed array');
		items.push(readValue(cursor));
		skipBlank(cursor);
		if (peek(cursor) === ',') {
			cursor.index += 1;
			continue;
		}
		if (peek(cursor) === ']') {
			cursor.index += 1;
			return items;
		}
		fail(cursor, 'expected `,`, `]`');
	}
}

function readInline(cursor: Cursor): Table {
	cursor.index += 1;
	const table: Table = {};
	skipSpace(cursor);
	if (peek(cursor) === '}') {
		cursor.index += 1;
		return table;
	}
	while (true) {
		skipSpace(cursor);
		readPair(cursor, table);
		skipSpace(cursor);
		if (peek(cursor) === ',') {
			cursor.index += 1;
			continue;
		}
		if (peek(cursor) === '}') {
			cursor.index += 1;
			return table;
		}
		fail(cursor, 'expected `,`, `}`');
	}
}

function readLiteral(cursor: Cursor): string {
	cursor.index += 1;
	const end = cursor.text.indexOf("'", cursor.index);
	const newline = cursor.text.indexOf('\n', cursor.index);
	if (end === -1 || (newline !== -1 && newline < end)) {
		fail(cursor, 'invalid literal string');
	}
	const value = cursor.text.slice(cursor.index, end);
	cursor.index = end + 1;
	return value;
}

function readMultiLiteral(cursor: Cursor): string {
	cursor.index += 3;
	if (peek(cursor) === '\n') cursor.index += 1;
	else if (startsWith(cursor, '\r\n')) cursor.index += 2;
	const end = cursor.text.indexOf("'''", cursor.index);
	if (end === -1) fail(cursor, 'invalid multiline literal string');
	// Up to two quotes may sit against the closing delimiter.
	let close = end;
	while (cursor.text[close + 3] === "'" && close < end + 2) close += 1;
	const value = cursor.text.slice(cursor.index, close);
	cursor.index = close + 3;
	return value;
}

function readBasic(cursor: Cursor): string {
	cursor.index += 1;
	let value = '';
	while (true) {
		if (isDone(cursor) || peek(cursor) === '\n') {
			fail(cursor, 'invalid basic string');
		}
		const char = peek(cursor);
		if (char === '"') {
			cursor.index += 1;
			return value;
		}
		if (char === '\\') {
			value += readEscape(cursor);
			continue;
		}
		value += char;
		cursor.index += 1;
	}
}

function readMultiBasic(cursor: Cursor): string {
	cursor.index += 3;
	if (peek(cursor) === '\n') cursor.index += 1;
	else if (startsWith(cursor, '\r\n')) cursor.index += 2;
	let value = '';
	while (true) {
		if (isDone(cursor)) fail(cursor, 'invalid multiline basic string');
		if (startsWith(cursor, '"""')) {
			let quotes = 3;
			while (peek(cursor, quotes) === '"' && quotes < 5) quotes += 1;
			value += '"'.repeat(quotes - 3);
			cursor.index += quotes;
			return value;
		}
		if (peek(cursor) === '\\') {
			const after = /^\\[ \t]*\r?\n/.exec(cursor.text.slice(cursor.index));
			if (after) {
				cursor.index += after[0].length;
				while (/[ \t\r\n]/.test(peek(cursor))) cursor.index += 1;
				continue;
			}
			value += readEscape(cursor);
			continue;
		}
		value += peek(cursor);
		cursor.index += 1;
	}
}

const ESCAPES: Readonly<Record<string, string>> = Object.freeze({
	b: '\b',
	t: '\t',
	n: '\n',
	f: '\f',
	r: '\r',
	e: '\x1b',
	'"': '"',
	'\\': '\\',
});

function readEscape(cursor: Cursor): string {
	const kind = peek(cursor, 1);
	const simple = ESCAPES[kind];
	if (simple !== undefined) {
		cursor.index += 2;
		return simple;
	}
	const width = kind === 'u' ? 4 : kind === 'U' ? 8 : 0;
	const hex = cursor.text.slice(cursor.index + 2, cursor.index + 2 + width);
	if (width === 0 || !new RegExp(`^[0-9A-Fa-f]{${width}}$`).test(hex)) {
		fail(cursor, 'invalid escape sequence');
	}
	const code = Number.parseInt(hex, 16);
	if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
		fail(cursor, 'invalid unicode escape');
	}
	cursor.index += 2 + width;
	return String.fromCodePoint(code);
}
