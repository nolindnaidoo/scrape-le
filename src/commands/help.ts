import * as vscode from 'vscode';
import type { Notifier, StatusBar } from '../types';

export function registerHelpCommand(
	context: vscode.ExtensionContext,
	_deps: Readonly<{
		notifier: Notifier;
		statusBar: StatusBar;
	}>,
): void {
	const command = vscode.commands.registerCommand(
		'scrape-le.help',
		async () => {
			const helpText = `
# Scrape-LE Help & Troubleshooting

## Commands
- **Check URL Scrapeability**: Prompt for a URL, load it in headless Chromium, and report reachability, anti-bot measures, rate limits, robots.txt rules, and authentication walls
- **Check Selected URL**: Run the same check on the URL in the current editor selection
- **Setup Browser**: Install the Chromium browser Scrape-LE drives (one-time, ~130MB)
- **Open Settings**: Open Scrape-LE settings
- **Help & Troubleshooting**: Open this document

## What a Check Reports
- Reachability: HTTP status code, page title, load time
- Console errors and page errors captured while the page loads
- Anti-bot detection: Cloudflare, reCAPTCHA, hCaptcha, DataDome
- Rate limiting: X-RateLimit-* / RateLimit-* / Retry-After response headers
- robots.txt: whether it exists, disallowed paths, crawl delay, sitemap
- Authentication: 401/403 status, login forms, auth keywords in the page
- A full-page screenshot saved into your workspace (configurable)

Results appear in the "Scrape-LE" output channel; a summary lands in the
status bar and a notification.

## Quick Start
1. Run "Scrape-LE: Setup Browser" once to install Chromium
2. Run "Scrape-LE: Check URL Scrapeability" (or press Ctrl+Alt+S / Cmd+Alt+S)
3. Enter the URL you plan to scrape
4. Read the report in the output channel

## Settings
All settings live under "scrape-le." in VS Code settings:
- **browser.timeout**: Page-load timeout in ms (default 30000)
- **browser.viewport.width / height**: Viewport size (default 1280×720)
- **browser.userAgent**: Custom User-Agent (empty = Chromium default)
- **screenshot.enabled**: Save a full-page screenshot (default on)
- **screenshot.path**: Where screenshots are written (default .vscode/scrape-le)
- **screenshot.format / quality**: png or jpeg, jpeg quality 0-100
- **checkConsoleErrors**: Capture console/page errors (default on)
- **detections.antiBot / rateLimit / robotsTxt / authentication**: Toggle individual detections
- **notificationsLevel**: all, important, or silent
- **statusBar.enabled**: Show the status bar item

## Troubleshooting

### "Chromium browser is required"
- Run "Scrape-LE: Setup Browser" and choose automatic installation
- Or run \`npx playwright-core install chromium\` in a terminal

### Check times out
- Increase scrape-le.browser.timeout in settings
- Some pages never go network-idle; try the URL in a browser first

### Screenshot missing
- Check scrape-le.screenshot.enabled
- The screenshot path must be writable inside your workspace

### Page loads in a browser but fails here
- The site may block headless browsers — that is exactly the signal
  Scrape-LE exists to surface before you write scraper code

## Support
- GitHub Issues: https://github.com/nolindnaidoo/scrape-le/issues
- Documentation: https://github.com/nolindnaidoo/scrape-le#readme
- LE Tools: https://letools.dev

Enjoying it? A rating helps more than you'd think:
- Rate on VS Code Marketplace: https://marketplace.visualstudio.com/items?itemName=nolindnaidoo.scrape-le&ssr=false#review-details
- Rate on Open VSX: https://open-vsx.org/extension/OffensiveEdge/scrape-le/reviews

Built by nolindnaidoo (https://github.com/nolindnaidoo) — MIT licensed.
		`.trim();

			const doc = await vscode.workspace.openTextDocument({
				content: helpText,
				language: 'markdown',
			});
			await vscode.window.showTextDocument(doc, {
				preview: false,
				viewColumn: vscode.ViewColumn.Beside,
			});
		},
	);

	context.subscriptions.push(command);
}
