/**
 * Manifest/nls parity: every %key% the manifest references must exist in
 * every catalogue, every catalogue must carry exactly the same key set,
 * and no catalogue may carry keys the manifest no longer uses.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..', '..');
const manifest = readFileSync(join(root, 'package.json'), 'utf8');
const usedKeys = [
	...new Set([...manifest.matchAll(/%([^%"]+)%/g)].map((m) => m[1])),
].sort();

const baseKeys = Object.keys(
	JSON.parse(readFileSync(join(root, 'package.nls.json'), 'utf8')),
).sort();

const catalogueFiles = readdirSync(join(root, 'src', 'i18n')).filter(
	(f) => f.startsWith('package.nls.') && f.endsWith('.json'),
);

describe('nls parity', () => {
	it('manifest uses only keys that exist in package.nls.json', () => {
		expect(usedKeys).toEqual(baseKeys);
	});

	it('ships all 12 translations', () => {
		expect(catalogueFiles).toHaveLength(12);
	});

	for (const file of catalogueFiles) {
		it(`${file} has exactly the base key set`, () => {
			const keys = Object.keys(
				JSON.parse(readFileSync(join(root, 'src', 'i18n', file), 'utf8')),
			).sort();
			expect(keys).toEqual(baseKeys);
		});
	}
});
