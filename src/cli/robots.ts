/**
 * One parsed robots.txt, asked about many paths: `crate/src/detect/robots.rs`.
 *
 * The extension's `parseRobotsTxt` answers one path per parse and does not say
 * which rule refused, and the CLI needs both. A batch parses a host's file once
 * and asks it a question per URL, and a refusal quotes the rule that decided it.
 * The canonical encoding is the extension's own, so the two cannot disagree
 * about what a pattern means.
 */
import { canonicalizeRobotsPath } from '../detectors/robotstxt';
import { rustTrim } from './url';

export type RobotsAnswer = Readonly<{
	exists: boolean;
	allowsCrawling: boolean;
	crawlDelay: number | undefined;
	disallowedPaths: readonly string[];
	sitemaps: readonly string[];
	agent: string;
	matchedRule: string | undefined;
}>;

type Rule = Readonly<{
	allow: boolean;
	pattern: string;
	matcher: RegExp | undefined;
	length: number;
}>;

type Group = { agents: string[]; rules: Rule[]; crawlDelay?: number };

export type RobotsDocument = Readonly<{
	unreachable: boolean;
	evaluate: (pathname: string, agent: string | undefined) => RobotsAnswer;
}>;

export function parseRobots(content: string): RobotsDocument {
	return documentOf(content, false);
}

/** RFC 9309 §2.3.1.4: rules that exist and could not be read disallow all. */
export function unreachableRobots(): RobotsDocument {
	return documentOf('User-agent: *\nDisallow: /\n', true);
}

function documentOf(content: string, unreachable: boolean): RobotsDocument {
	const { groups, sitemaps } = parseGroups(content);
	return Object.freeze({
		unreachable,
		evaluate: (pathname: string, agent: string | undefined): RobotsAnswer => {
			const token = agent === undefined ? '' : productToken(agent);
			const named =
				token !== '' && groups.some((group) => group.agents.includes(token));
			const answering = named ? token : '*';
			const selected = groups.filter((group) =>
				group.agents.includes(answering),
			);
			const rules = selected.flatMap((group) => group.rules);
			const crawlDelay = [...selected]
				.reverse()
				.find((group) => group.crawlDelay !== undefined)?.crawlDelay;
			const decision = decidePath(canonicalizeRobotsPath(pathname), rules);
			return Object.freeze({
				exists: !unreachable,
				allowsCrawling: decision.allowed,
				crawlDelay,
				disallowedPaths: rules
					.filter((rule) => !rule.allow)
					.map((rule) => rule.pattern),
				sitemaps,
				agent: answering,
				matchedRule: decision.matched,
			});
		},
	});
}

function productToken(agent: string): string {
	return rustTrim(agent.split('/')[0] ?? agent).toLowerCase();
}

function parseGroups(content: string): {
	groups: Group[];
	sitemaps: string[];
} {
	const groups: Group[] = [];
	const sitemaps: string[] = [];
	let agents: string[] = [];
	let inGroupHeader = false;

	for (const rawLine of content.split('\n')) {
		const hash = rawLine.indexOf('#');
		const line = rustTrim(hash === -1 ? rawLine : rawLine.slice(0, hash));
		if (line === '') continue;
		const colon = line.indexOf(':');
		if (colon === -1) continue;
		const directive = rustTrim(line.slice(0, colon)).toLowerCase();
		const value = rustTrim(line.slice(colon + 1));

		if (directive === 'user-agent') {
			if (!inGroupHeader) {
				agents = [];
				inGroupHeader = true;
				groups.push({ agents: [], rules: [] });
			}
			agents.push(value.toLowerCase());
			const last = groups[groups.length - 1];
			if (last) last.agents = [...agents];
			continue;
		}
		inGroupHeader = false;

		if (directive === 'sitemap') {
			if (value !== '') sitemaps.push(value);
			continue;
		}
		const group = groups[groups.length - 1];
		if (!group) continue;

		if ((directive === 'disallow' || directive === 'allow') && value !== '') {
			const encoded = canonicalizeRobotsPath(value);
			group.rules.push(
				Object.freeze({
					allow: directive === 'allow',
					pattern: value,
					matcher: compilePattern(encoded),
					length: encoded.length,
				}),
			);
			continue;
		}
		if (directive === 'crawl-delay') {
			const delay = Number.parseFloat(value);
			if (!Number.isNaN(delay) && delay >= 0) group.crawlDelay = delay;
		}
	}
	return { groups, sitemaps };
}

function decidePath(
	path: string,
	rules: readonly Rule[],
): { allowed: boolean; matched: string | undefined } {
	let bestLength = -1;
	let bestAllow = true;
	let bestPattern: string | undefined;
	for (const rule of rules) {
		if (!rule.matcher?.test(path)) continue;
		const winsTie = rule.length === bestLength && rule.allow && !bestAllow;
		if (rule.length > bestLength || winsTie) {
			bestLength = rule.length;
			bestAllow = rule.allow;
			bestPattern = rule.pattern;
		}
	}
	return { allowed: bestAllow, matched: bestAllow ? undefined : bestPattern };
}

function compilePattern(pattern: string): RegExp | undefined {
	const anchored = pattern.endsWith('$');
	const body = anchored ? pattern.slice(0, -1) : pattern;
	const escaped = body
		.split('*')
		.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
		.join('[\\s\\S]*');
	try {
		return new RegExp(`^${escaped}${anchored ? '$' : ''}`);
	} catch {
		return undefined;
	}
}
