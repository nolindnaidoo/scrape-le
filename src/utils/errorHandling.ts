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

	if (!context) {
		return error;
	}

	Object.assign(error, context);
	return error;
}

/**
 * Extracts error message from unknown error type
 */
export function extractErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}

	if (typeof error === 'string') {
		return error;
	}

	return 'An unknown error occurred';
}

/**
 * Checks if error is a timeout error
 */
export function isTimeoutError(error: unknown): boolean {
	const message = extractErrorMessage(error).toLowerCase();
	return message.includes('timeout') || message.includes('timed out');
}

/**
 * Checks if error is a network error
 */
export function isNetworkError(error: unknown): boolean {
	const message = extractErrorMessage(error).toLowerCase();
	return (
		message.includes('net::') ||
		message.includes('network') ||
		message.includes('connection') ||
		message.includes('enotfound') ||
		message.includes('econnrefused')
	);
}

/**
 * Formats error for user display with appropriate prefix
 */
export function formatErrorForUser(error: unknown): string {
	const message = extractErrorMessage(error);

	if (isTimeoutError(error)) {
		return `⏱️ Timeout: ${message}`;
	}

	if (isNetworkError(error)) {
		return `🔌 Network error: ${message}`;
	}

	return `❌ Error: ${message}`;
}
