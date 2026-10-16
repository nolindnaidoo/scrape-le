/**
 * A network failure as the crate's report words it.
 *
 * ureq prints Rust's `io::Error`, so a refused connection reads
 * `Connection refused (os error 61)` on macOS, `(os error 111)` on Linux and
 * Windows' own sentence and code on Windows. A name that does not resolve is
 * getaddrinfo's message behind std's prefix, except on Windows, where it
 * arrives as WSAHOST_NOT_FOUND. Node folds all of these into libuv names, so
 * the platform's text is spelled out here for the failures a fetch meets.
 */
import { rustIoMessage } from './ioError';

/** strerror on macOS and on glibc, where they differ. */
const POSIX: Readonly<
	Record<
		string,
		Readonly<{ darwin: [number, string]; linux: [number, string] }>
	>
> = Object.freeze({
	ECONNREFUSED: {
		darwin: [61, 'Connection refused'],
		linux: [111, 'Connection refused'],
	},
	ECONNRESET: {
		darwin: [54, 'Connection reset by peer'],
		linux: [104, 'Connection reset by peer'],
	},
	ETIMEDOUT: {
		darwin: [60, 'Operation timed out'],
		linux: [110, 'Connection timed out'],
	},
	EHOSTUNREACH: {
		darwin: [65, 'No route to host'],
		linux: [113, 'No route to host'],
	},
	ENETUNREACH: {
		darwin: [51, 'Network is unreachable'],
		linux: [101, 'Network is unreachable'],
	},
	ECONNABORTED: {
		darwin: [53, 'Software caused connection abort'],
		linux: [103, 'Software caused connection abort'],
	},
	EPIPE: { darwin: [32, 'Broken pipe'], linux: [32, 'Broken pipe'] },
	EADDRNOTAVAIL: {
		darwin: [49, "Can't assign requested address"],
		linux: [99, 'Cannot assign requested address'],
	},
});

/** Winsock's codes and FormatMessage's sentences. */
const WINDOWS: Readonly<Record<string, readonly [number, string]>> =
	Object.freeze({
		ECONNREFUSED: [
			10061,
			'No connection could be made because the target machine actively refused it.',
		],
		ECONNRESET: [
			10054,
			'An existing connection was forcibly closed by the remote host.',
		],
		ETIMEDOUT: [
			10060,
			'A connection attempt failed because the connected party did not properly respond after a period of time, or established connection failed because connected host has failed to respond.',
		],
		EHOSTUNREACH: [
			10065,
			'A socket operation was attempted to an unreachable host.',
		],
		ENETUNREACH: [
			10051,
			'A socket operation was attempted to an unreachable network.',
		],
		ECONNABORTED: [
			10053,
			'An established connection was aborted by the software in your host machine.',
		],
		EADDRNOTAVAIL: [
			10049,
			'The requested address is not valid in its context.',
		],
		ENOTFOUND: [11001, 'No such host is known.'],
		EAI_AGAIN: [
			11002,
			'This is usually a temporary error during hostname resolution and means that the local server did not receive a response from an authoritative server.',
		],
	});

/** gai_strerror for a name that did not resolve. */
const RESOLVER: Readonly<
	Record<string, Readonly<{ darwin: string; linux: string }>>
> = Object.freeze({
	ENOTFOUND: {
		darwin: 'nodename nor servname provided, or not known',
		linux: 'Name or service not known',
	},
	EAI_AGAIN: {
		darwin: 'temporary failure in name resolution',
		linux: 'Temporary failure in name resolution',
	},
	EAI_FAIL: {
		darwin: 'non-recoverable failure in name resolution',
		linux: 'Non-recoverable failure in name resolution',
	},
});

export function rustNetMessage(
	error: unknown,
	platform: NodeJS.Platform = process.platform,
): string {
	const code = (error as { code?: unknown } | null)?.code;
	if (typeof code !== 'string') return rustIoMessage(error, platform);
	if (platform === 'win32') {
		const windows = WINDOWS[code];
		if (windows) return `${windows[1]} (os error ${windows[0]})`;
		return rustIoMessage(error, platform);
	}
	const flavour = platform === 'linux' ? 'linux' : 'darwin';
	const resolver = RESOLVER[code];
	if (resolver) {
		return `failed to lookup address information: ${resolver[flavour]}`;
	}
	const posix = POSIX[code];
	if (posix) {
		const [errno, text] = posix[flavour];
		return `${text} (os error ${errno})`;
	}
	return rustIoMessage(error, platform);
}
