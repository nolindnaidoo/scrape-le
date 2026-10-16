#!/usr/bin/env node
/**
 * npm command-line package gate.
 *
 * Packs `cli/`, installs the tarball into a clean throwaway project, and runs
 * the *installed* `scrape-le` against a page served on loopback. That is what
 * `npx scrape-le` does, minus the registry, so it catches what a source-level
 * test cannot: a missing `files` entry, a bin path that does not resolve, a
 * lost shebang, or a bundle that still reaches for a dev dependency.
 *
 * Runs before publishing, because a broken version can never be reused. The
 * throwaway project is left in the OS temp directory rather than deleted.
 *
 *   node scripts/build-cli.js --prod && node scripts/check-cli-package.js
 */
const cp = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const root = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const manifest = JSON.parse(fs.readFileSync('cli/package.json', 'utf8'));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-check-'));

function fail(message, detail) {
	console.error(`\n  ✗ ${message}`);
	if (detail) console.error(`    ${detail}`);
	process.exit(1);
}

const npm = (args, cwd) =>
	cp.execFileSync('npm', args, { cwd, encoding: 'utf8', stdio: 'pipe' });

/** Asynchronous, so the page server in this process can answer the binary. */
function run(bin, args, cwd, input = '') {
	return new Promise((resolve) => {
		const child = cp.spawn(bin, args, { cwd });
		let stdout = '';
		let stderr = '';
		child.stdout.on('data', (chunk) => {
			stdout += chunk;
		});
		child.stderr.on('data', (chunk) => {
			stderr += chunk;
		});
		child.on('close', (status) => resolve({ status, stdout, stderr }));
		child.stdin.end(input);
	});
}

async function main() {
	if (manifest.version !== root.version) {
		fail(`cli/package.json is ${manifest.version}, package.json is ${root.version}`);
	}

	// A README telling people to `npx` a package this repo does not publish
	// sends them to nothing, or to someone else's package.
	const published = [
		manifest.name,
		JSON.parse(fs.readFileSync('mcp/package.json', 'utf8')).name,
	];
	for (const readme of ['README.md', 'cli/README.md', 'crate/README.md', 'mcp/README.md']) {
		for (const [, named] of fs
			.readFileSync(readme, 'utf8')
			.matchAll(/npx (?:-\S+ )*([\w@/.-]+)/g)) {
			if (!published.includes(named)) {
				fail(
					`${readme} says \`npx ${named}\``,
					`the published packages are ${published.join(' and ')}`,
				);
			}
		}
	}

	const packed = JSON.parse(
		npm(['pack', path.resolve('cli'), '--json', '--pack-destination', workspace]),
	)[0];
	const shipped = packed.files.map((file) => file.path).sort();
	const expected = ['LICENSE', 'README.md', 'cli.js', 'package.json'];
	if (JSON.stringify(shipped) !== JSON.stringify(expected)) {
		fail('the tarball does not carry exactly the expected files', `got: ${shipped.join(', ')}`);
	}
	// No runtime dependency: the package drives a browser over Chrome's own
	// pipe and speaks HTTP over a socket, so `npx` fetches one tarball.
	if (Object.keys(manifest.dependencies ?? {}).length > 0) {
		fail('cli/package.json declares dependencies', Object.keys(manifest.dependencies).join(', '));
	}

	const project = path.join(workspace, 'project');
	fs.mkdirSync(project);
	fs.writeFileSync(
		path.join(project, 'package.json'),
		JSON.stringify({ name: 'cli-check', version: '1.0.0', private: true }),
	);
	npm(['install', path.join(workspace, packed.filename), '--no-audit', '--no-fund'], project);

	const bin = path.join(project, 'node_modules', '.bin', 'scrape-le');
	if (!fs.existsSync(bin)) fail('npm did not install a `scrape-le` binary', 'check the bin field');

	const version = await run(bin, ['--version'], project);
	if (version.stdout.trim() !== `scrape-le ${root.version}`) {
		fail('--version does not report the release', `got: ${JSON.stringify(version.stdout)}`);
	}

	// The question this tool exists for, over loopback: a path the site's
	// robots.txt refuses. No browser is needed for that answer.
	const server = http.createServer((request, response) => {
		if (request.url === '/robots.txt') {
			response.writeHead(200, { 'content-type': 'text/plain' });
			response.end('User-agent: *\nDisallow: /private\n');
			return;
		}
		response.writeHead(200, { 'content-type': 'text/html' });
		response.end('<title>Private</title>');
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	const url = `http://127.0.0.1:${server.address().port}/private/page`;
	const check = await run(bin, ['--no-render', url], project);
	server.close();
	let report;
	try {
		report = JSON.parse(check.stdout);
	} catch {
		fail('the installed binary did not write a JSON report', check.stderr || check.stdout);
	}
	const finding = report.findings.map((f) => `${f.kind}:${f.detail}`).join(' ');
	if (check.status !== 1 || report.title !== 'Private' || finding !== 'robots:Disallow: /private for User-agent: *') {
		fail('the installed binary answered wrongly', `exit ${check.status}, ${finding}`);
	}

	const mcp = await run(
		bin,
		['mcp'],
		project,
		`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })}\n`,
	);
	const tools = JSON.parse(mcp.stdout.split('\n')[0] || '{}').result?.tools ?? [];
	const names = tools.map((tool) => tool.name).join(', ');
	if (names !== 'analyze_robots_txt, scrape_le_check, scrape_le_doctor') {
		fail('`scrape-le mcp` does not serve its three tools', `got: ${names}`);
	}

	console.log(`  ✓ ${manifest.name}@${manifest.version}: packed, installed, checked, served`);
}

main();
