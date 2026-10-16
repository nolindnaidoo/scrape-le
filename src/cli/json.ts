/**
 * JSON written the way serde_json writes it, so the two `scrape-le` binaries
 * print the same bytes.
 *
 * Two things differ from `JSON.stringify`. A Rust `f64` keeps its fraction, so
 * a crawl-delay of ten is `10.0`, and a `serde_json::Value` object keeps its
 * keys sorted, because the crate builds without `preserve_order`. A report
 * printed on stdout is a struct and keeps its field order; the same report
 * inside an MCP reply has been through `Value` and is sorted. Both callers say
 * which they want.
 */

/** A number Rust holds as `f64`, which serializes with its fraction. */
export type Float = Readonly<{ float: number }>;

export function float(value: number): Float {
	return Object.freeze({ float: value });
}

function isFloat(value: unknown): value is Float {
	return (
		typeof value === 'object' &&
		value !== null &&
		Object.keys(value).length === 1 &&
		typeof (value as { float?: unknown }).float === 'number'
	);
}

export type JsonOptions = Readonly<{ sorted: boolean; indent?: number }>;

export function toJson(value: unknown, options: JsonOptions): string {
	return write(value, options, 0);
}

function write(value: unknown, options: JsonOptions, depth: number): string {
	if (value === null || value === undefined) return 'null';
	if (isFloat(value)) return rustJsonFloat(value.float);
	if (typeof value === 'number') return JSON.stringify(value);
	// An integer past 2^53, which serde writes digit for digit.
	if (typeof value === 'bigint') return value.toString();
	if (typeof value === 'string' || typeof value === 'boolean') {
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return container(
			value.map((item) => write(item, options, depth + 1)),
			'[',
			']',
			options,
			depth,
		);
	}
	const entries = Object.entries(value as Record<string, unknown>).filter(
		([, item]) => item !== undefined,
	);
	if (options.sorted) {
		entries.sort(([a], [b]) => compareBytes(a, b));
	}
	const separator = options.indent === undefined ? ':' : ': ';
	return container(
		entries.map(
			([key, item]) =>
				`${JSON.stringify(key)}${separator}${write(item, options, depth + 1)}`,
		),
		'{',
		'}',
		options,
		depth,
	);
}

function container(
	items: readonly string[],
	open: string,
	close: string,
	options: JsonOptions,
	depth: number,
): string {
	if (items.length === 0) return `${open}${close}`;
	if (options.indent === undefined) return `${open}${items.join(',')}${close}`;
	const inner = ' '.repeat(options.indent * (depth + 1));
	const outer = ' '.repeat(options.indent * depth);
	return `${open}\n${inner}${items.join(`,\n${inner}`)}\n${outer}${close}`;
}

/** A `BTreeMap<String, _>` orders keys by their UTF-8 bytes. */
function compareBytes(a: string, b: string): number {
	const left = Buffer.from(a, 'utf8');
	const right = Buffer.from(b, 'utf8');
	return Buffer.compare(left, right);
}

/**
 * The shortest digits that round-trip, and where the decimal point sits.
 * `toExponential()` with no argument is ECMAScript's shortest round-trip form,
 * the same digits ryu chooses.
 */
function shortest(value: number): { digits: string; exponent: number } {
	const [mantissa = '0', power = '0'] = Math.abs(value)
		.toExponential()
		.split('e');
	return {
		digits: mantissa.replace('.', ''),
		exponent: Number.parseInt(power, 10),
	};
}

/**
 * serde_json's float, which it writes with the `zmij` crate, and `null` for a
 * value JSON cannot hold. Plain notation for decimal exponents from -5 to 15,
 * with a `.0` on a whole number; otherwise scientific with a signed exponent,
 * `1e+18`.
 */
export function rustJsonFloat(value: number): string {
	if (!Number.isFinite(value)) return 'null';
	const sign = value < 0 || Object.is(value, -0) ? '-' : '';
	if (value === 0) return `${sign}0.0`;
	const { digits, exponent } = shortest(value);
	const length = digits.length;
	// The position of the decimal point counted from the first digit.
	const point = exponent + 1;
	if (point > 0 && point <= 16) {
		if (length <= point) {
			return `${sign}${digits}${'0'.repeat(point - length)}.0`;
		}
		return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
	}
	if (point <= 0 && point > -5) {
		return `${sign}0.${'0'.repeat(-point)}${digits}`;
	}
	const mantissa =
		length === 1 ? digits : `${digits.slice(0, 1)}.${digits.slice(1)}`;
	return `${sign}${mantissa}e${exponent < 0 ? '-' : '+'}${Math.abs(exponent)}`;
}

/**
 * Rust's `Display` for `f64`: the shortest round-trip digits written out
 * positionally, never in exponent form, and no `.0` on a whole number.
 */
export function rustFloatDisplay(value: number): string {
	if (Number.isNaN(value)) return 'NaN';
	if (value === Number.POSITIVE_INFINITY) return 'inf';
	if (value === Number.NEGATIVE_INFINITY) return '-inf';
	const sign = value < 0 || Object.is(value, -0) ? '-' : '';
	if (value === 0) return `${sign}0`;
	const { digits, exponent } = shortest(value);
	const point = exponent + 1;
	if (point <= 0) return `${sign}0.${'0'.repeat(-point)}${digits}`;
	if (digits.length <= point) {
		return `${sign}${digits}${'0'.repeat(point - digits.length)}`;
	}
	return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}
