/**
 * Core type definitions for Scrape-LE
 */

/**
 * Result of a scrapeability check
 */
export type CheckResult = Readonly<{
	success: boolean;
	url: string;
	statusCode: number | null;
	title: string;
	loadTimeMs: number;
	screenshotPath?: string | undefined;
	consoleErrors: readonly string[];
	error?: string | undefined;
	detections?: DetectionResults | undefined;
}>;

/**
 * Options for performing a scrapeability check
 */
export type CheckOptions = Readonly<{
	timeout: number;
	viewport: Readonly<{
		width: number;
		height: number;
	}>;
	userAgent?: string | undefined;
	screenshotEnabled: boolean;
	screenshotPath: string;
	screenshotFormat: 'png' | 'jpeg';
	screenshotQuality: number;
	checkConsoleErrors: boolean;
	detections: Readonly<{
		antiBot: boolean;
		rateLimit: boolean;
		robotsTxt: boolean;
		authentication: boolean;
	}>;
}>;

/**
 * Extension configuration
 */
export type Config = Readonly<{
	browser: Readonly<{
		timeout: number;
		viewport: Readonly<{
			width: number;
			height: number;
		}>;
		userAgent?: string | undefined;
	}>;
	screenshot: Readonly<{
		enabled: boolean;
		path: string;
		format: 'png' | 'jpeg';
		quality: number;
	}>;
	checkConsoleErrors: boolean;
	notificationsLevel: NotificationLevel;
	statusBar: Readonly<{
		enabled: boolean;
	}>;
	detections: Readonly<{
		antiBot: boolean;
		rateLimit: boolean;
		robotsTxt: boolean;
		authentication: boolean;
	}>;
}>;

/**
 * Notification verbosity levels
 */
export type NotificationLevel = 'all' | 'important' | 'silent';

/**
 * Status bar interface
 */
export type StatusBar = Readonly<{
	show(message: string, tooltip?: string): void;
	hide(): void;
	dispose(): void;
}>;

/**
 * Notifier interface for user feedback
 */
export type Notifier = Readonly<{
	info(message: string): void;
	warn(message: string): void;
	error(message: string): void;
}>;

/**
 * Console message captured from the browser
 */
export type ConsoleMessage = Readonly<{
	type: 'log' | 'error' | 'warning' | 'info';
	text: string;
	timestamp: number;
}>;

/**
 * Aggregated detection results from all detectors
 */
export type DetectionResults = Readonly<{
	antiBot?: AntiBotDetection | undefined;
	rateLimit?: RateLimitInfo | undefined;
	robotsTxt?: RobotsTxtInfo | undefined;
	authentication?: AuthenticationInfo | undefined;
}>;

/**
 * Anti-bot protection detection results
 */
export type AntiBotDetection = Readonly<{
	cloudflare: boolean;
	recaptcha: boolean;
	hcaptcha: boolean;
	datadome: boolean;
	perimeter81: boolean;
	details: readonly string[];
}>;

/**
 * Rate limiting information from response headers
 */
export type RateLimitInfo = Readonly<{
	detected: boolean;
	limit?: string | undefined;
	remaining?: string | undefined;
	reset?: string | undefined;
	retryAfter?: string | undefined;
}>;

/**
 * robots.txt parsing results
 */
export type RobotsTxtInfo = Readonly<{
	exists: boolean;
	allowsCrawling: boolean;
	crawlDelay?: number | undefined;
	disallowedPaths: readonly string[];
	sitemap?: string | undefined;
}>;

/**
 * Authentication requirement detection results
 */
export type AuthenticationInfo = Readonly<{
	required: boolean;
	type?: 'form' | 'oauth' | 'basic' | 'session' | undefined;
	loginUrl?: string | undefined;
	indicators: readonly string[];
}>;
