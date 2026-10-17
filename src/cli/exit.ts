/**
 * Exit once every stream has handed its last write to the reader.
 *
 * `process.exit` drops whatever a pipe has not yet taken, and on macOS and
 * Windows stdout and stderr are pipes that write asynchronously. Waiting on
 * stdout alone cut off the end of the stderr listing and its summary line
 * whenever the reader was slower than the writer.
 */
export function exitWhenDrained(
	code: number,
	streams: readonly NodeJS.WritableStream[] = [process.stdout, process.stderr],
	exit: (code: number) => void = process.exit,
): void {
	let pending = streams.length;
	for (const stream of streams) {
		stream.write('', () => {
			pending -= 1;
			if (pending === 0) exit(code);
		});
	}
}
