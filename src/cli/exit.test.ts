import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { exitWhenDrained } from './exit';

/** A pipe whose reader takes `delay` milliseconds over every chunk. */
function slowPipe(name: string, delay: number, taken: string[]): Writable {
	return new Writable({
		write(chunk, _encoding, done) {
			setTimeout(() => {
				if (chunk.length > 0) taken.push(name);
				done();
			}, delay);
		},
	});
}

describe('exitWhenDrained', () => {
	it('exits only after the slower stream has been read', async () => {
		const taken: string[] = [];
		const stdout = slowPipe('stdout', 1, taken);
		const stderr = slowPipe('stderr', 25, taken);
		stdout.write('report\n');
		stderr.write('summary\n');

		const atExit = await new Promise<{ code: number; taken: string[] }>(
			(resolve) =>
				exitWhenDrained(2, [stdout, stderr], (code) =>
					resolve({ code, taken: [...taken] }),
				),
		);

		expect(atExit).toEqual({ code: 2, taken: ['stdout', 'stderr'] });
	});
});
