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
	userAgentAttempts?: readonly UserAgentAttempt[] | undefined;
}>;

/**
 * One re-check of the same URL under a different User-Agent.
 *
 * `outcome` is what that agent produced: a clean load, a load that still
 * tripped bot detection, or an outright failure.
 */
export type UserAgentAttempt = Readonly<{
	label: string;
	userAgent: string;
	outcome: 'ok' | 'bot-detected' | 'failed';
	statusCode: number | null;
	error?: string | undefined;
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
	/** The crawler robots.txt is evaluated as; generic rules when absent. */
	robotsAgent?: string | undefined;
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
	retry: Readonly<{
		userAgents: boolean;
	}>;
	screenshot: Readonly<{
		enabled: boolean;
		path: string;
		format: 'png' | 'jpeg';
		quality: number;
	}>;
	checkConsoleErrors: boolean;
	robotsAgent: string;
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
	/**
	 * Restores the idle text after `delayMs`, unless something is shown
	 * first. One reset is pending at most; a new show or reset replaces it,
	 * and dispose cancels it.
	 */
	resetAfter(delayMs: number): void;
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
	/**
	 * Detections that were requested but threw.
	 *
	 * Each detector runs independently so one failure cannot take the whole
	 * check down, but a failure used to leave its field simply absent — and the
	 * report skips absent fields. A detector that errored was therefore
	 * indistinguishable from one that was switched off, with the only record a
	 * console.error the user never opens. Reporting the failure is the point of
	 * running the check.
	 */
	failures?: readonly DetectionFailure[] | undefined;
}>;

export type DetectionFailure = Readonly<{
	detection: 'antiBot' | 'rateLimit' | 'robotsTxt' | 'authentication';
	message: string;
}>;

/**
 * Anti-bot protection detection results
 */
export type AntiBotDetection = Readonly<{
	cloudflare: boolean;
	recaptcha: boolean;
	hcaptcha: boolean;
	datadome: boolean;
	perimeterx: boolean;
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
	/** Which group answered: `*`, or the agent's product token. */
	agent: string;
	allowsCrawling: boolean;
	/**
	 * Why the file could not be read, when it could not: a 5xx status, a
	 * timeout or a network failure. RFC 9309 §2.3.1.4 has a crawler assume a
	 * complete disallow then, so `allowsCrawling` is false and `exists` stays
	 * false, because no file was served.
	 */
	unreachable?: string | undefined;
	crawlDelay?: number | undefined;
	disallowedPaths: readonly string[];
	sitemaps: readonly string[];
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
