/**
 * URL validation and processing utilities
 */

/**
 * Regular expression for URL validation
 */
const URL_REGEX =
	/^https?:\/\/(www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&//=]*)$/;

/**
 * Validates if a string is a valid URL
 */
export function isValidUrl(url: string): boolean {
	if (!url || typeof url !== 'string') {
		return false;
	}

	const trimmed = url.trim();

	// Try native URL validation first
	try {
		const parsedUrl = new URL(trimmed);
		return parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:';
	} catch {
		// Fallback to regex
		return URL_REGEX.test(trimmed);
	}
}

/**
 * Normalizes a URL by adding protocol if missing
 */
export function normalizeUrl(url: string): string {
	const trimmed = url.trim();

	// Already has protocol
	if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
		return trimmed;
	}

	// Add https by default
	return `https://${trimmed}`;
}

/**
 * Extracts a URL from text (finds first valid URL)
 */
export function extractUrlFromText(text: string): string | null {
	if (!text) {
		return null;
	}

	// Try to find URLs in the text
	const urlPattern =
		/https?:\/\/(www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&//=]*)/g;
	const matches = text.match(urlPattern);

	if (matches && matches.length > 0) {
		return matches[0];
	}

	// Check if the entire text is a URL without protocol
	const normalized = normalizeUrl(text);
	if (isValidUrl(normalized)) {
		return normalized;
	}

	return null;
}

/**
 * Creates a safe filename from a URL
 */
export function urlToFilename(url: string): string {
	try {
		const parsed = new URL(url);
		const hostname = parsed.hostname.replace(/\./g, '-');
		const timestamp = new Date().toISOString().split('T')[0];
		return `${hostname}-${timestamp}`;
	} catch {
		// Fallback to simple sanitization
		return url
			.replace(/[^a-z0-9]/gi, '-')
			.toLowerCase()
			.substring(0, 100);
	}
}

export const UrlUtils = Object.freeze({
	isValidUrl,
	normalizeUrl,
	extractUrlFromText,
	urlToFilename,
});
