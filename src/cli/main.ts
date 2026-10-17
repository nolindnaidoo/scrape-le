/**
 * The `scrape-le` npm binary: the Rust CLI's surface, rebuilt over the
 * extension's detection data. `scrape-le mcp` serves the crate's three tools.
 */
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { version } from '../mcp/info';
import { exitWhenDrained } from './exit';
import { serve } from './mcp';
import { doctor, run } from './run';
import { BUILT_IN } from './signatures';

const stdout = (text: string): void => {
	process.stdout.write(text);
};
const stderr = (text: string): void => {
	process.stderr.write(text);
};

async function main(args: readonly string[]): Promise<void> {
	if (args[0] === 'doctor') {
		exitWhenDrained(doctor({ stdout }));
		return;
	}
	if (args[0] === 'mcp') {
		const lines = createInterface({
			input: process.stdin,
			crlfDelay: Number.POSITIVE_INFINITY,
		});
		exitWhenDrained(
			await serve({ version, signatures: BUILT_IN, stderr }, lines, (line) => {
				process.stdout.write(line);
			}),
		);
		return;
	}
	exitWhenDrained(
		await run(args, {
			stdout,
			stderr,
			stdoutIsTerminal: process.stdout.isTTY === true,
			readStdin: () => readFileSync(0),
			version,
		}),
	);
}

void main(process.argv.slice(2));
