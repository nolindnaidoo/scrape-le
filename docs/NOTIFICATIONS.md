# Scrape‑LE Notifications Guide

This document describes Scrape‑LE's notification behavior, levels, and best practices for managing feedback during scrapeability checks.

## Notification Philosophy

Scrape‑LE follows these principles:

- **Minimal by default**: Only show important information (warnings and errors)
- **Configurable**: Users control notification verbosity
- **Non-intrusive**: Use Status Bar and Output channel over popup notifications
- **Contextual**: Notifications appear only when relevant

## Notification Levels

### Level: `all`

Shows all notifications including informational messages.

**What you'll see:**

- ✅ Check started
- ✅ Browser launched
- ✅ Page loaded successfully
- ⚠️ Warnings (slow load, anti-bot detected)
- ❌ Errors (timeout, network failure)

**Best for:**

- First-time users learning the extension
- Debugging issues
- Detailed feedback preference
- Development and testing

**Example output:**

```
ℹ️ Starting check for https://example.com
✅ Browser launched successfully
✅ Page loaded in 1.5s
✅ Screenshot saved to .vscode/scrape-le/
✅ Check complete
```

### Level: `important` (Default)

Shows only warnings and errors.

**What you'll see:**

- ⚠️ Warnings (anti-bot detected, slow load, rate limits)
- ❌ Errors (timeout, network failure, browser issues)

**Best for:**

- Daily use
- Balance between awareness and minimal distraction
- Most users (recommended default)

**Example output:**

```
⚠️ Anti-bot system detected: Cloudflare
⚠️ Rate limit: 95/100 requests remaining
```

### Level: `silent`

Suppresses all notifications.

**What you'll see:**

- Nothing in VS Code notifications
- Results still available in Output channel
- Status Bar still updates

**Best for:**

- Power users who prefer Output channel
- Automated workflows
- Minimal UI distraction
- Screen recording / presentations

**Note:** Errors will still appear in Output channel.

## Configuration

### Setting notification level

**Via Settings UI:**

1. Open Settings (`Cmd/Ctrl + ,`)
2. Search "scrape-le notifications"
3. Select desired level

**Via settings.json:**

```json
{
  "scrape-le.notificationsLevel": "important" // "all" | "important" | "silent"
}
```

### Workspace-specific notifications

Override notification level per workspace:

`.vscode/settings.json`:

```json
{
  "scrape-le.notificationsLevel": "silent" // Quiet for this project
}
```

## Notification Types

### Informational (Level: `all` only)

**Check Started:**

```
ℹ️ Starting scrapeability check for https://example.com
```

**Browser Launched:**

```
ℹ️ Browser launched successfully
```

**Page Loaded:**

```
✅ Page loaded in 2.3s
```

**Screenshot Saved:**

```
✅ Screenshot saved to .vscode/scrape-le/example-com-2025-01-13.png
```

**Check Complete:**

```
✅ Scrapeability check complete
```

### Warnings (Level: `important` and above)

**Anti-Bot Detection:**

```
⚠️ Anti-bot system detected: Cloudflare
⚠️ reCAPTCHA detected on page
⚠️ hCaptcha detected on page
```

**Rate Limiting:**

```
⚠️ Rate limit detected: 95/100 requests remaining
⚠️ Rate limit exceeded. Retry after 60 seconds
```

**Authentication Required:**

```
⚠️ Authentication wall detected (login form present)
⚠️ 401 Unauthorized - authentication may be required
```

**robots.txt Restrictions:**

```
⚠️ robots.txt disallows crawling of this path
⚠️ Crawl-delay of 10 seconds recommended
```

**Performance Warnings:**

```
⚠️ Page took 15s to load (timeout: 30s)
⚠️ Large page (10MB) - check may take longer
```

**Console Errors:**

```
⚠️ 5 JavaScript errors detected during page load
```

### Errors (All levels show in Output channel)

**Timeout:**

```
❌ Page load timed out after 30s
```

**Network Failure:**

```
❌ Network error: Unable to reach https://example.com
❌ DNS resolution failed for example.com
```

**Browser Issues:**

```
❌ Browser launch failed - run Setup Browser command
❌ Chromium not found - install via Setup Browser
```

**Invalid Input:**

```
❌ Invalid URL format
❌ No URL selected
```

**Permission Errors:**

```
❌ Cannot write screenshot to .vscode/scrape-le/
```

## Output Channel

All notifications are also written to the Output channel regardless of notification level.

**Accessing Output channel:**

1. View → Output (`Cmd/Ctrl + Shift + U`)
2. Select "Scrape-LE" from dropdown

**Output format:**

```
[2025-01-13T10:30:15] Check started: https://example.com
[2025-01-13T10:30:16] Browser launched (850ms)
[2025-01-13T10:30:18] Page loaded (1.8s)
[2025-01-13T10:30:18] Screenshot: .vscode/scrape-le/example-com-2025-01-13.png
[2025-01-13T10:30:19] Anti-bot detected: Cloudflare
[2025-01-13T10:30:19] Check complete (4.1s total)
```

**Benefits:**

- Complete check history
- Detailed timing information
- Copyable for bug reports
- Survives VS Code reload (until cleared)

## Status Bar

The Status Bar provides real-time check progress and results:

**States:**

**Idle:**

```
$(globe) Scrape-LE
```

Click to run Check URL command.

**Checking:**

```
$(sync~spin) Checking...
```

Animated spinner during check.

**Success:**

```
$(check) Reachable (1.5s)
```

Shows duration on hover.

**Failed:**

```
$(x) Failed
```

Click for details in Output channel.

**Status Bar configuration:**

```json
{
  "scrape-le.statusBar.enabled": true // Show Status Bar item
}
```

## Notification Best Practices

### For Daily Use

**Recommended:**

```json
{
  "scrape-le.notificationsLevel": "important"
}
```

Benefits:

- Alerted to issues (anti-bot, rate limits)
- Not overwhelmed with routine confirmations
- Clean notification center

### For Debugging

**Recommended:**

```json
{
  "scrape-le.notificationsLevel": "all"
}
```

Benefits:

- See each step of the check process
- Identify where delays occur
- Confirm expected behavior

### For Automation / CI

**Recommended:**

```json
{
  "scrape-le.notificationsLevel": "silent",
  "scrape-le.statusBar.enabled": false
}
```

Benefits:

- No UI interruptions
- Check Output channel programmatically
- Clean logs

### For Presentations / Screen Recording

**Recommended:**

```json
{
  "scrape-le.notificationsLevel": "silent"
}
```

Benefits:

- No notification popups during recording
- Status Bar still provides feedback
- Results available in Output channel

## Notification Timing

### Immediate Notifications

- Errors (network, timeout, browser)
- Invalid input
- Permission issues

### Progress Notifications

- Check started
- Browser launched
- Page loading

### Completion Notifications

- Check complete
- Screenshot saved
- Detection results

## Troubleshooting Notifications

### Not seeing expected notifications

**Check notification level:**

```json
{
  "scrape-le.notificationsLevel": "all" // Ensure not "silent"
}
```

**Check VS Code notification settings:**

1. VS Code Settings → Notifications
2. Ensure notifications are enabled globally

**Check Output channel:**

- All messages appear in Output channel regardless of level
- View → Output → "Scrape-LE"

### Too many notifications

**Reduce verbosity:**

```json
{
  "scrape-le.notificationsLevel": "important" // or "silent"
}
```

**Clear notification history:**

- Click bell icon in VS Code
- Clear all notifications

### Missing error notifications

**Errors always logged:**

- Even with `"silent"` level
- Check Output channel → "Scrape-LE"
- Look for `[ERROR]` prefix

**Enable important notifications:**

```json
{
  "scrape-le.notificationsLevel": "important"
}
```

## Related Documentation

- [Configuration Guide](CONFIGURATION.md) - Detailed settings reference
- [Status Bar Guide](STATUSBAR.md) - Status Bar integration details
- [Troubleshooting](TROUBLESHOOTING.md) - Common issues and solutions

---

**Project:** [Issues](https://github.com/nolindnaidoo/scrape-le/issues) • [Pull Requests](https://github.com/nolindnaidoo/scrape-le/pulls) • [Releases](https://github.com/nolindnaidoo/scrape-le/releases) • [MIT License](LICENSE)

**Dev:** [Spec](SPECIFICATION.md) • [Architecture](ARCHITECTURE.md) • [Development](DEVELOPMENT.md) • [Troubleshooting](TROUBLESHOOTING.md)

**Docs:** [Commands](COMMANDS.md) • [Notifications](NOTIFICATIONS.md) • [Status Bar](STATUSBAR.md) • [Config](CONFIGURATION.md) • [Performance](PERFORMANCE.md) • [Privacy](PRIVACY.md) • [Screenshots](SCREENSHOTS.md) • [Workflow](WORKFLOW.md)
