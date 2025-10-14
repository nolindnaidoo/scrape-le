import * as vscode from "vscode";
import type { Notifier, StatusBar } from "../types";

export function registerHelpCommand(
  context: vscode.ExtensionContext,
  deps: Readonly<{
    notifier: Notifier;
    statusBar: StatusBar;
  }>
): void {
  const command = vscode.commands.registerCommand(
    "scrape-le.help",
    async () => {
      const helpText = `
# Scrape-LE Help & Troubleshooting

## Commands
- **Check URL**: Check if a URL is reachable and get response details
- **Check Selection**: Check selected text as URL
- **Setup Playwright**: Install Playwright browser for advanced scraping
- **Export Results**: Export scraping results to file
- **Open Settings**: Configure Scrape-LE settings
- **Help**: Open this help documentation

## What Scrape-LE Does
Scrape-LE is a lightweight URL checking and web scraping tool:
- Check URL reachability
- Get response status codes
- Measure response times
- Basic content extraction
- Playwright integration for JavaScript-heavy sites

## Quick Start
1. Open a file with URLs (markdown, HTML, JSON, etc.)
2. Right-click on a URL → "Scrape-LE: Check URL"
3. Or select text containing a URL → "Scrape-LE: Check Selection"
4. View response details (status, time, headers)

## URL Checking
**Basic Check:**
- Verifies URL is reachable
- Returns HTTP status code (200, 404, etc.)
- Measures response time
- Shows basic headers

**What Gets Checked:**
- URL reachability (can we connect?)
- HTTP status code (success/error)
- Response time (performance)
- Content type
- Redirects (if any)

## Playwright Integration
For JavaScript-rendered sites, use Playwright:

**Setup:**
1. Run "Scrape-LE: Setup Playwright"
2. Wait for browser installation (one-time)
3. Playwright will be used for future checks when enabled

**When to Use:**
- Single Page Applications (React, Vue, Angular)
- Sites that require JavaScript to load content
- Dynamic content that loads after page load
- Sites with client-side rendering

**When NOT to Use:**
- Simple static sites (faster without Playwright)
- Basic URL reachability checks
- When you want faster response times

## Export Results
Save check results for documentation or analysis:
1. Perform URL checks
2. Run "Scrape-LE: Export Results"
3. Choose format (JSON, CSV, Markdown)
4. Results saved to workspace

## Troubleshooting

### URL check fails
- Verify URL is valid and complete (include http:// or https://)
- Check network connection
- Try the URL in a browser first
- Check if site blocks automated requests

### Timeout errors
- Increase timeout in settings
- Check if site is slow or unresponsive
- Try without Playwright first (faster)

### Playwright not working
- Run "Setup Playwright" command again
- Check internet connection during setup
- Restart VS Code after installation
- Check Output panel → "Scrape-LE" for errors

### Results not exporting
- Ensure you have write permissions
- Check workspace folder exists
- Verify export location in settings
- Check Output panel for errors

## Settings
Access settings via Command Palette: "Scrape-LE: Open Settings"

Key settings:
- **Request timeout**: Maximum time to wait for response (default: 10s)
- **Use Playwright**: Enable browser-based checking (default: false)
- **Export format**: Default format for exports (JSON, CSV, Markdown)
- **Export location**: Where to save exported results
- **Notification levels**: Control verbosity (silent, important, all)
- **Status bar**: Show/hide status bar item
- **Telemetry**: Local logging only (default: false)

## Common Use Cases

### Check all links in documentation
1. Open markdown file with links
2. Right-click each URL → "Check URL"
3. Fix any broken links (404, timeout, etc.)

### Verify API endpoints
1. Open file with API URLs
2. Check each endpoint for reachability
3. Export results for documentation

### Test before deployment
1. Check all production URLs
2. Verify redirects work correctly
3. Test response times
4. Export results as deployment checklist

### Monitor site health
1. Check key URLs regularly
2. Track response times
3. Get alerts for failures
4. Export results for tracking

## Performance Tips
- Use basic checking (no Playwright) when possible
- Adjust timeout for faster/slower sites
- Check URLs in batches
- Export results for later analysis

## Limitations
- No authentication support (yet)
- Basic content extraction only
- Limited to HTTP/HTTPS protocols
- Rate limiting by target sites may apply

## Planned Features
- URL validation and normalization
- Bulk URL checking
- Response content preview
- Authentication support
- Custom headers
- Retry logic

## Support
- GitHub Issues: https://github.com/nolindnaidoo/scrape-le/issues
- Documentation: https://github.com/nolindnaidoo/scrape-le#readme
		`.trim();

      const doc = await vscode.workspace.openTextDocument({
        content: helpText,
        language: "markdown",
      });
      await vscode.window.showTextDocument(doc);
    }
  );

  context.subscriptions.push(command);
}
