/**
 * Characterization tests: pin the CURRENT url-utility behavior per input,
 * including quirks (normalizeUrl blindly prefixing https:// onto non-URLs,
 * extractUrl falling back to whole-text normalization, filename embedding
 * the current date so same-day checks overwrite screenshots).
 *
 * System time is frozen because convertUrlToFilename embeds today's date.
 * Behavior changes must update these snapshots in the same commit.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
	convertUrlToFilename,
	extractUrl,
	normalizeUrl,
	validateUrl,
} from './url';

const inputs = readFileSync(
	join(__dirname, '__fixtures__', 'url-inputs.txt'),
	'utf8',
)
	.split('\n')
	.filter((line) => line.length > 0);

beforeAll(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-07-29T12:00:00Z'));
});

afterAll(() => {
	vi.useRealTimers();
});

describe('url utils characterization', () => {
	for (const input of inputs) {
		it(`input: ${JSON.stringify(input)}`, () => {
			expect({
				validate: validateUrl(input),
				normalize: normalizeUrl(input),
				extract: extractUrl(input),
				filename: convertUrlToFilename(input),
			}).toMatchSnapshot();
		});
	}
});
