/**
 * The vendor corpus the check runs against: the extension's own table, which
 * `scripts/check-signature-parity.ts` holds equal to `crate/signatures/`, plus
 * whatever `--signatures` adds. Follows `crate/src/detect/signatures.rs`.
 */
import { readFileSync, statSync } from 'node:fs';
import { ANTI_BOT_SIGNATURES } from '../detectors/heuristics';
import { decodeUtf8OrThrow, rustIoMessage } from './ioError';
import { parseToml, type TomlValue } from './toml';

export type HeaderSignature = Readonly<{ name: string; contains?: string }>;

export type Signature = Readonly<{
	key: string;
	label: string;
	headers: readonly HeaderSignature[];
	scriptSubstrings: readonly string[];
	selectors: readonly string[];
	globals: readonly string[];
}>;

export const BUILT_IN: readonly Signature[] = ANTI_BOT_SIGNATURES;

/**
 * A key matching a built-in replaces it, a new key extends the corpus, and the
 * built-ins keep their order, which decides which vendor a header names first.
 */
export function merge(
	base: readonly Signature[],
	extra: readonly Signature[],
): readonly Signature[] {
	const merged = [...base];
	for (const signature of extra) {
		const index = merged.findIndex((s) => s.key === signature.key);
		if (index === -1) {
			merged.push(signature);
			continue;
		}
		merged[index] = signature;
	}
	return Object.freeze(merged);
}

/** The signatures a file adds, or the message refusing it. */
export function loadExtra(
	path: string,
):
	| { ok: true; signatures: readonly Signature[] }
	| { ok: false; message: string } {
	// A named pipe with no writer never finishes a read, so only a regular file
	// is read at all.
	try {
		if (!statSync(path).isFile()) {
			return {
				ok: false,
				message: `could not read ${path}: not a regular file`,
			};
		}
	} catch (error) {
		return {
			ok: false,
			message: `could not read ${path}: ${rustIoMessage(error)}`,
		};
	}
	let raw: string;
	try {
		raw = decodeUtf8OrThrow(readFileSync(path));
	} catch (error) {
		return {
			ok: false,
			message: `could not read ${path}: ${rustIoMessage(error)}`,
		};
	}
	try {
		return { ok: true, signatures: parseExtra(raw) };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { ok: false, message: `${path}: ${message}` };
	}
}

/**
 * `[[signature]]` entries, or one signature table. As serde reads them: the
 * list is tried first, and a file that is not a valid list is read as one
 * signature, whose error is the one reported.
 */
export function parseExtra(raw: string): readonly Signature[] {
	const document = parseToml(raw);
	const list = document.signature;
	if (Array.isArray(list)) {
		try {
			return Object.freeze(list.map((item) => toSignature(item)));
		} catch {
			// Falls through to the single-table reading, as serde's untagged
			// attempt does.
		}
	}
	return Object.freeze([toSignature(document)]);
}

function toSignature(value: TomlValue): Signature {
	const table = asTable(value, 'struct VendorSignature');
	return Object.freeze({
		key: requiredString(table, 'key'),
		label: requiredString(table, 'label'),
		headers: Object.freeze(
			optionalList(table, 'headers').map((item) => {
				const header = asTable(item, 'struct HeaderSignature');
				const name = requiredString(header, 'name');
				const contains = header.contains;
				if (contains === undefined) return Object.freeze({ name });
				return Object.freeze({ name, contains: asString(contains) });
			}),
		),
		scriptSubstrings: strings(table, 'script_substrings'),
		selectors: strings(table, 'selectors'),
		globals: strings(table, 'globals'),
	});
}

function asTable(
	value: TomlValue,
	expected: string,
): { [key: string]: TomlValue } {
	if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
		return value as { [key: string]: TomlValue };
	}
	throw new Error(`invalid type: ${describe(value)}, expected ${expected}`);
}

function requiredString(
	table: { [key: string]: TomlValue },
	name: string,
): string {
	const value = table[name];
	if (value === undefined) throw new Error(`missing field \`${name}\``);
	return asString(value);
}

function asString(value: TomlValue): string {
	if (typeof value === 'string') return value;
	throw new Error(`invalid type: ${describe(value)}, expected a string`);
}

function optionalList(
	table: { [key: string]: TomlValue },
	name: string,
): readonly TomlValue[] {
	const value = table[name];
	if (value === undefined) return [];
	if (Array.isArray(value)) return value;
	throw new Error(`invalid type: ${describe(value)}, expected a sequence`);
}

function strings(
	table: { [key: string]: TomlValue },
	name: string,
): readonly string[] {
	return Object.freeze(optionalList(table, name).map(asString));
}

function describe(value: TomlValue): string {
	if (typeof value === 'string') return `string "${value}"`;
	if (typeof value === 'boolean') return `boolean \`${value}\``;
	if (typeof value === 'number') {
		return Number.isInteger(value)
			? `integer \`${value}\``
			: `floating point \`${value}\``;
	}
	if (Array.isArray(value)) return 'sequence';
	return 'map';
}
