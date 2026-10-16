/**
 * The `scrape-le` npm binary: the Rust CLI's surface, rebuilt over the
 * extension's detection data. `scrape-le mcp` serves the crate's three tools.
 */
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { version } from '../mcp/info';
import { serve } from './mcp';
import { doctor, run } from './run';
import { BUILT_IN } from './signatures';

/**
 * Waits for stdout to drain before exiting: `process.exit` on a pipe can cut
 * off the report still buffered, and a truncated JSON line is worse than none.
 */
function exitWith(code: number): void {
	process.stdout.write('', () => process.exit(code));
}

const stdout = (text: string): void => {
	process.stdout.write(text);
};
const stderr = (text: string): void => {
	process.stderr.write(text);
};

async function main(args: readonly string[]): Promise<void> {
	if (args[0] === 'doctor') {
		exitWith(doctor({ stdout }));
		return;
	}
	if (args[0] === 'mcp') {
		const lines = createInterface({
			input: process.stdin,
			crlfDelay: Number.POSITIVE_INFINITY,
		});
		exitWith(
			await serve({ version, signatures: BUILT_IN, stderr }, lines, (line) => {
				process.stdout.write(line);
			}),
		);
		return;
	}
	exitWith(
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
