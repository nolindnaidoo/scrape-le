/**
 * Error handling utilities for Scrape-LE
 */

/**
 * Creates an enhanced error with additional context
 */
export function createEnhancedError(
	message: string,
	context?: Readonly<Record<string, unknown>>,
): Error {
	const error = new Error(message);
	if (context) {
		Object.assign(error, context);
	}
	return error;
}

/**
 * Safely extracts error message from unknown error type
 */
export function getErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	if (typeof error === 'string') {
		return error;
	}
	return 'An unknown error occurred';
}

/**
 * Checks if an error is a timeout error
 */
export function isTimeoutError(error: unknown): boolean {
	const message = getErrorMessage(error).toLowerCase();
	return message.includes('timeout') || message.includes('timed out');
}

/**
 * Checks if an error is a network error
 */
export function isNetworkError(error: unknown): boolean {
	const message = getErrorMessage(error).toLowerCase();
	return (
		message.includes('net::') ||
		message.includes('network') ||
		message.includes('connection') ||
		message.includes('enotfound') ||
		message.includes('econnrefused')
	);
}

/**
 * Formats error for user display
 */
export function formatErrorForUser(error: unknown): string {
	const message = getErrorMessage(error);

	if (isTimeoutError(error)) {
		return `⏱️ Timeout: ${message}`;
	}

	if (isNetworkError(error)) {
		return `🔌 Network error: ${message}`;
	}

	return `❌ Error: ${message}`;
}

export const ErrorHandling = Object.freeze({
	createEnhancedError,
	getErrorMessage,
	isTimeoutError,
	isNetworkError,
	formatErrorForUser,
});
