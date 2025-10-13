# Scrape‑LE Workflow Guide

This document describes common workflows, usage patterns, and best practices for using Scrape‑LE effectively in your development process.

## Quick Start Workflow

### First-Time Setup

**Step 1: Install Extension**

```
1. Open VS Code
2. Extensions → Search "Scrape-LE"
3. Click "Install"
4. Reload VS Code
```

**Step 2: Install Chromium (First Use Only)**

```
1. Run any check command
2. Click "Install Chromium" when prompted
3. Wait for ~130MB download
4. Installation complete
```

**Step 3: Run First Check**

```
1. Press Cmd/Ctrl+Alt+S
2. Enter URL (e.g., https://example.com)
3. Wait for results
4. View Output channel for details
```

## Common Workflows

### Workflow 1: Pre-Scraper Development Validation

**Goal:** Verify target URL is suitable for scraping before writing scraper code

**Steps:**

1. Identify target URL for scraping
2. Run Scrape-LE check with all detections enabled
3. Review results:
   - ✅ Reachable? → Proceed
   - ⚠️ Anti-bot detected? → Plan accordingly
   - ⚠️ Rate limits? → Implement throttling
   - ⚠️ Auth required? → Handle login
   - ⚠️ robots.txt disallows? → Reconsider or request permission
4. Document findings
5. Proceed with scraper development

**Configuration:**

```json
{
  "scrape-le.detections.antiBot": true,
  "scrape-le.detections.rateLimit": true,
  "scrape-le.detections.robotsTxt": true,
  "scrape-le.detections.authentication": true,
  "scrape-le.screenshot.enabled": true
}
```

### Workflow 2: Bulk URL Validation

**Goal:** Check multiple URLs from a list

**Steps:**

1. Copy URLs to a file or editor
2. For each URL:
   - Select URL text
   - Right-click → "Scrape-LE: Check Selection"
   - Wait for result
   - Note any issues
3. Review Output channel for summary
4. Export results (copy from Output channel)

**Tip:** Use `"notificationsLevel": "silent"` to avoid notification spam

### Workflow 3: CI/CD Pre-Deployment Check

**Goal:** Verify scraper targets are still accessible before deployment

**Steps:**

1. Configure workspace settings for CI:
   ```json
   {
     "scrape-le.notificationsLevel": "silent",
     "scrape-le.screenshot.enabled": false,
     "scrape-le.browser.timeout": 30000
   }
   ```
2. Run checks programmatically (future feature)
3. Parse Output channel for failures
4. Block deployment if critical targets unreachable

### Workflow 4: Scraper Debugging

**Goal:** Diagnose why scraper is failing on specific URL

**Steps:**

1. Enable verbose logging:
   ```json
   {
     "scrape-le.notificationsLevel": "all",
     "scrape-le.checkConsoleErrors": true
   }
   ```
2. Run check on failing URL
3. Review Output channel for:
   - Console errors (JS failures)
   - Anti-bot detection (blocking)
   - Rate limiting (throttling)
   - Page load timing
4. Open saved screenshot to verify page state
5. Adjust scraper based on findings

### Workflow 5: Mobile Responsiveness Check

**Goal:** Verify page works on mobile viewport

**Steps:**

1. Configure mobile viewport:
   ```json
   {
     "scrape-le.browser.viewport.width": 375,
     "scrape-le.browser.viewport.height": 667
   }
   ```
2. Run check
3. Review screenshot for mobile layout
4. Verify no mobile-specific anti-bot measures
5. Adjust scraper for mobile if needed

### Workflow 6: API Endpoint Validation

**Goal:** Verify API endpoint is reachable and returns data

**Steps:**

1. Configure minimal checks:
   ```json
   {
     "scrape-le.screenshot.enabled": false,
     "scrape-le.checkConsoleErrors": false,
     "scrape-le.detections.rateLimit": true,
     "scrape-le.browser.timeout": 10000
   }
   ```
2. Check API endpoint URL
3. Verify reachability
4. Check for rate limiting headers
5. Note response time

## Best Practices

### General Best Practices

**1. Start with Default Settings**

- Use default configuration first
- Adjust only when needed
- Don't over-optimize prematurely

**2. Enable Relevant Detections Only**

- Disable unused detections for speed
- Enable all for comprehensive analysis
- Consider your use case

**3. Use Workspace Settings**

- Keep project-specific config in workspace
- Use user settings for personal preferences
- Document workspace settings in README

**4. Monitor Output Channel**

- Review detailed results in Output channel
- Don't rely solely on notifications
- Copy/paste results for documentation

**5. Save Screenshots Selectively**

- Enable for visual confirmation
- Disable for quick reachability checks
- Store in version control if valuable

### Performance Best Practices

**1. Adjust Timeout Based on Site**

- Fast sites: 10-15s timeout
- Average sites: 30s (default)
- Slow sites: 60-90s timeout

**2. Reduce Viewport for Speed**

- Smaller viewports = faster screenshots
- Use 1280x720 for balance
- Only use 4K for specific needs

**3. Batch Checks Efficiently**

- Use silent notifications for batches
- Check during idle time
- Allow time between checks

### Privacy Best Practices

**1. Review URLs Before Checking**

- Don't check sensitive/internal URLs from untrusted sources
- Be aware of what you're accessing
- Consider using proxies for sensitive checks

**2. Secure Screenshot Storage**

- Keep screenshots in .gitignore
- Store in secure directories
- Delete after review if sensitive

**3. Respect robots.txt**

- Enable robots.txt checking
- Honor disallow directives
- Request permission if needed

### Development Best Practices

**1. Document Findings**

- Keep notes on detection results
- Track anti-bot systems encountered
- Share findings with team

**2. Version Control Configuration**

- Commit workspace settings
- Document why specific settings chosen
- Update as needs change

**3. Regular Validation**

- Recheck targets periodically
- Sites change anti-bot measures
- Update scrapers accordingly

## Use Case Examples

### Use Case: E-commerce Price Monitoring

**Scenario:** Building price monitoring scraper for e-commerce sites

**Workflow:**

1. Check product page reachability
2. Enable all detections
3. Note Cloudflare/anti-bot presence
4. Check rate limiting headers
5. Review robots.txt for allowed paths
6. Screenshot for visual confirmation
7. Document findings:
   - Anti-bot: Cloudflare detected
   - Rate limit: 100/hour
   - robots.txt: Allows /products
   - Recommendation: Use delays, respect limits

**Configuration:**

```json
{
  "scrape-le.detections.antiBot": true,
  "scrape-le.detections.rateLimit": true,
  "scrape-le.detections.robotsTxt": true,
  "scrape-le.browser.timeout": 45000
}
```

### Use Case: News Article Scraping

**Scenario:** Scraping news articles for analysis

**Workflow:**

1. Check article page URLs
2. Enable auth detection (paywalls)
3. Check robots.txt compliance
4. Screenshot for layout verification
5. Note any anti-scraping measures
6. Document paywall behavior

**Configuration:**

```json
{
  "scrape-le.detections.authentication": true,
  "scrape-le.detections.robotsTxt": true,
  "scrape-le.screenshot.enabled": true
}
```

### Use Case: API Documentation Scraping

**Scenario:** Extracting API docs from developer portal

**Workflow:**

1. Quick reachability check
2. Disable unnecessary detections
3. Fast timeout (docs usually fast)
4. No screenshots needed
5. Check for rate limits on API calls

**Configuration:**

```json
{
  "scrape-le.browser.timeout": 10000,
  "scrape-le.screenshot.enabled": false,
  "scrape-le.detections.antiBot": false,
  "scrape-le.detections.rateLimit": true
}
```

### Use Case: SPA Content Scraping

**Scenario:** Scraping React/Vue single-page applications

**Workflow:**

1. Enable console error checking (JS issues)
2. Longer timeout for JS execution
3. Screenshot to confirm render
4. Check for dynamic anti-bot
5. Monitor console for API errors

**Configuration:**

```json
{
  "scrape-le.browser.timeout": 60000,
  "scrape-le.checkConsoleErrors": true,
  "scrape-le.screenshot.enabled": true,
  "scrape-le.detections.antiBot": true
}
```

## Integration Patterns

### Pattern 1: VS Code Task Integration

**Goal:** Run checks as VS Code tasks

**tasks.json:**

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "Check Scraper Targets",
      "type": "shell",
      "command": "echo",
      "args": ["Run Scrape-LE checks manually via Command Palette"],
      "group": {
        "kind": "test",
        "isDefault": true
      }
    }
  ]
}
```

**Note:** Future versions may support programmatic API

### Pattern 2: Documentation Integration

**Goal:** Document scraper targets with check results

**Example README.md:**

```markdown
## Scraper Targets

### Target 1: Product Pages

- URL: https://example.com/products
- Last Checked: 2025-01-13
- Status: ✅ Reachable
- Anti-bot: Cloudflare detected
- Rate Limit: 100/hour
- robots.txt: Allowed

### Target 2: API Endpoint

- URL: https://api.example.com/v1/data
- Last Checked: 2025-01-13
- Status: ✅ Reachable
- Anti-bot: None
- Rate Limit: 1000/hour
- robots.txt: N/A (API)
```

### Pattern 3: Team Collaboration

**Goal:** Share check configurations and results with team

**Workspace settings:**

```json
{
  "scrape-le.browser.timeout": 45000,
  "scrape-le.screenshot.path": "scraper-checks/screenshots",
  "scrape-le.detections.antiBot": true,
  "scrape-le.detections.rateLimit": true,
  "scrape-le.detections.robotsTxt": true,
  "scrape-le.detections.authentication": true
}
```

**Commit to repository:**

- `.vscode/settings.json` - Shared configuration
- `scraper-checks/results/` - Check results (optional)
- `scraper-checks/screenshots/` - Visual references

## Troubleshooting Workflows

### Workflow: Diagnosing Timeout Issues

**Steps:**

1. Check URL in regular browser (timing)
2. Enable verbose logging
3. Run check with extended timeout
4. Review Output channel for slow steps
5. Adjust timeout or investigate site issues

### Workflow: Handling Anti-Bot Detection

**Steps:**

1. Run check with anti-bot detection
2. Identify specific system (Cloudflare, etc.)
3. Research bypass strategies (legal/ethical only)
4. Plan scraper architecture accordingly
5. Consider alternatives if too restrictive

### Workflow: Resolving Rate Limit Issues

**Steps:**

1. Run check with rate limit detection
2. Note limit values (requests/hour)
3. Calculate required delay between requests
4. Implement throttling in scraper
5. Monitor for 429 responses

## Advanced Workflows

### Advanced: Custom Detection Analysis

**Goal:** Combine Scrape-LE results with custom analysis

**Steps:**

1. Run Scrape-LE check
2. Copy results from Output channel
3. Parse results programmatically
4. Combine with custom checks
5. Generate report

**Example parsing:**

```typescript
// Future: Programmatic API
const result = await scrapeLE.check("https://example.com");
if (result.detections?.antiBot?.cloudflare) {
  console.log("Cloudflare detected");
}
```

### Advanced: Multi-Viewport Testing

**Goal:** Check how site behaves across viewports

**Steps:**

1. Define viewport profiles (mobile, tablet, desktop)
2. For each profile:
   - Update viewport settings
   - Run check
   - Save screenshot with profile name
3. Compare results across viewports
4. Note any viewport-specific issues

### Advanced: Historical Comparison

**Goal:** Track changes in site behavior over time

**Steps:**

1. Run initial check
2. Save results and screenshots
3. Schedule periodic rechecks
4. Compare new results with baseline
5. Identify changes (new anti-bot, rate limits, etc.)

## Tips & Tricks

**Tip 1: Quick Reachability Test**

- Disable all detections for fastest check
- Just verify URL is accessible
- Use for smoke testing

**Tip 2: Keyboard Shortcuts**

- `Cmd/Ctrl+Alt+S` - Quick check
- `Cmd/Ctrl+Shift+P` - Command Palette
- Select URL + Right-click - Context menu

**Tip 3: Output Channel Navigation**

- `Cmd/Ctrl+Shift+U` - Open Output
- Select "Scrape-LE" from dropdown
- Searchable with `Cmd/Ctrl+F`

**Tip 4: Status Bar Monitoring**

- Click Status Bar for quick checks
- Hover for last result details
- Click "Failed" state for error info

**Tip 5: Screenshot Organization**

- Use descriptive screenshot paths
- Group by project or target type
- Add to .gitignore if sensitive

## Related Documentation

- [Commands Guide](COMMANDS.md) - Available commands
- [Configuration Guide](CONFIGURATION.md) - Settings reference
- [Troubleshooting](TROUBLESHOOTING.md) - Common issues
- [Performance Guide](PERFORMANCE.md) - Optimization tips

---

**Project:** [Issues](https://github.com/nolindnaidoo/scrape-le/issues) • [Pull Requests](https://github.com/nolindnaidoo/scrape-le/pulls) • [Releases](https://github.com/nolindnaidoo/scrape-le/releases) • [MIT License](LICENSE)

**Dev:** [Spec](SPECIFICATION.md) • [Architecture](ARCHITECTURE.md) • [Development](DEVELOPMENT.md) • [Troubleshooting](TROUBLESHOOTING.md)

**Docs:** [Commands](COMMANDS.md) • [Notifications](NOTIFICATIONS.md) • [Status Bar](STATUSBAR.md) • [Config](CONFIGURATION.md) • [Performance](PERFORMANCE.md) • [Privacy](PRIVACY.md) • [Screenshots](SCREENSHOTS.md) • [Workflow](WORKFLOW.md)
