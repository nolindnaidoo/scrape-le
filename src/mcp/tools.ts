import { parseRobotsTxt } from '../detectors/robotstxt';
import { normalizeUrl, validateUrl } from '../utils/url';
import {
	capped,
	DEFAULT_MAX_RESULTS,
	type Diagnostic,
	envelope,
	MAX_MAX_RESULTS,
	note,
	readMaxResults,
	readString,
} from './envelope';
import type { ToolDefinition } from './transport';

/**
 * The tools this server exposes.
 *
 * Names are a public API with no deprecation channel — once an agent's prompt
 * or memory references `analyze_robots_txt`, renaming it breaks silently. They
 * are pinned by a golden test for that reason.
 *
 * **This server makes no network requests.** The extension's own
 * `fetchRobotsTxt` builds its URL from an arbitrary origin, so inside an agent
 * loop it would be an SSRF primitive — `http://169.254.169.254/robots.txt`
 * resolves on a cloud host, and the caller supplying the URL is the model, not
 * the user. The agent already has HTTP tools the user has approved; this server
 * takes the content it fetched and does the analysis, which is the half that
 * needs the extension's rules engine.
 *
 * That also keeps this server matching every other one in the family: content
 * in, structured data out, no network and no filesystem.
 */

const MAX_RESULTS_SCHEMA = {
	type: 'integer',
	minimum: 1,
	maximum: MAX_MAX_RESULTS,
	default: DEFAULT_MAX_RESULTS,
	description: `Cap on returned disallowed paths (default ${DEFAULT_MAX_RESULTS}). meta.truncated reports whether any were dropped.`,
};

/**
 * The path robots.txt rules are matched against.
 *
 * Rules apply to a path, not a whole URL, so a caller that passes
 * `https://example.com/admin` has to have it reduced to `/admin` — matching the
 * full URL against `Disallow: /admin` would silently never match and report
 * everything as allowed, which is the dangerous direction to be wrong in.
 */
function toPathname(target: string): { pathname: string; note?: string } {
	const trimmed = target.trim();
	if (trimmed.startsWith('/')) {
		return { pathname: trimmed };
	}

	// Only an explicit scheme makes this a URL. Normalising first would read
	// `admin` as the *host* `https://admin`, whose pathname is `/` — and `/`
	// matches no Disallow rule, so a path the caller meant to check would come
	// back allowed. Guessing wrong toward "you may crawl this" is the one
	// direction that causes harm.
	if (trimmed.includes('://')) {
		const candidate = normalizeUrl(trimmed);
		if (validateUrl(candidate)) {
			return { pathname: new URL(candidate).pathname };
		}
	}

	const pathname = `/${trimmed.replace(/^\/+/, '')}`;
	return {
		pathname,
		note: `\`${target}\` has no leading slash and no scheme; it was read as the path ${pathname}.`,
	};
}

function analyze(args: Record<string, unknown>): Promise<unknown> {
	const content = readString(args, 'content');
	const target = readString(args, 'path');
	const maxResults = readMaxResults(args);

	const { pathname, note: pathNote } = toPathname(target);
	const diagnostics: Diagnostic[] = pathNote ? [note(pathNote)] : [];

	const info = parseRobotsTxt(content, pathname);
	const disallowed = capped(info.disallowedPaths, maxResults);

	return Promise.resolve(
		envelope(
			'analyze_robots_txt',
			{
				path: pathname,
				allowsCrawling: info.allowsCrawling,
				crawlDelay: info.crawlDelay,
				disallowedPaths: disallowed.items,
				sitemaps: info.sitemaps,
			},
			disallowed.items.length,
			diagnostics,
			disallowed.truncated,
		),
	);
}

export const TOOLS: readonly ToolDefinition[] = Object.freeze([
	Object.freeze({
		name: 'analyze_robots_txt',
		description:
			'Given the contents of a robots.txt file and a path, report whether the generic (User-agent: *) rules permit crawling it, along with the crawl delay, the disallowed patterns and any sitemaps. Takes the file contents directly and makes no network request of its own — fetch robots.txt with your own HTTP tool and pass what it returned.',
		inputSchema: {
			type: 'object',
			properties: {
				content: {
					type: 'string',
					description: 'The contents of the robots.txt file.',
				},
				path: {
					type: 'string',
					description:
						'The path to check, e.g. "/admin". A full URL is accepted and reduced to its path.',
				},
				maxResults: MAX_RESULTS_SCHEMA,
			},
			required: ['content', 'path'],
			additionalProperties: false,
		},
		handler: analyze,
	}),
]);
