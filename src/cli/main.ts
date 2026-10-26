/**
 * The `scrape-le` npm binary: the Rust CLI's surface, rebuilt over the
 * extension's detection data. `scrape-le mcp` serves the crate's three tools.
 */
import { readFileSync } from 'node:fs';
import { version } from '../mcp/info';
import { serve } from './mcp';
import { crateOutput } from './output';
import { doctor, run } from './run';
import { BUILT_IN } from './signatures';

const REFUSAL = 'could not write the report';

async function main(args: readonly string[]): Promise<void> {
	const output = crateOutput('scrape-le');
	const { stdout, stderr } = output;
	if (args[0] === 'doctor') {
		output.exit(doctor({ stdout }), REFUSAL);
		return;
	}
	if (args[0] === 'mcp') {
		// The crate's server stops at the first reply it cannot write.
		process.stdout.once('error', () => output.exit(2, null));
		// A full pipe is waited out before the next frame is read, as the
		// crate's blocking write waits it out.
		const writeReply = (line: string): Promise<void> | undefined =>
			process.stdout.write(line)
				? undefined
				: new Promise((resolve) => process.stdout.once('drain', resolve));
		output.exit(
			await serve(
				{ version, signatures: BUILT_IN, stderr },
				process.stdin,
				writeReply,
			),
			null,
		);
		return;
	}
	output.exit(
		await run(args, {
			stdout,
			stderr,
			stdoutIsTerminal: process.stdout.isTTY === true,
			readStdin: () => readFileSync(0),
			version,
		}),
		REFUSAL,
	);
}

void main(process.argv.slice(2));
