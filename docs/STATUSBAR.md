# Scrape‑LE Status Bar Guide

This document describes the Status Bar integration, states, and interaction patterns for Scrape‑LE.

## Status Bar Overview

The Scrape‑LE Status Bar item provides:

- Quick access to check URL command
- Real-time check progress feedback
- At-a-glance result status
- Minimal UI footprint

**Location:** Bottom Status Bar (left side)

**Visibility:** Configurable via `scrape-le.statusBar.enabled`

## Status Bar States

### Idle State

**Display:**

```
$(globe) Scrape-LE
```

**Icon:** Globe icon indicates web checking functionality

**Tooltip:** "Click to check URL scrapeability"

**Interaction:**

- Click: Opens URL input prompt
- Equivalent to running "Scrape-LE: Check URL" command
- Keybinding: `Cmd/Ctrl+Alt+S`

**When shown:**

- Extension activated
- No check currently running
- Default idle state

### Checking State

**Display:**

```
$(sync~spin) Checking...
```

**Icon:** Animated spinning sync icon

**Tooltip:** Shows URL being checked

**Interaction:**

- Click: No action (check in progress)
- Progress cannot be cancelled from Status Bar
- Use Output channel to monitor detailed progress

**When shown:**

- Browser launching
- Page loading
- Running detections
- Capturing screenshot

**Duration:** 1-30s typically (depends on site)

### Success State

**Display:**

```
$(check) Reachable (1.5s)
```

**Icon:** Checkmark indicates successful check

**Tooltip:**

```
Successfully checked: https://example.com
Duration: 1.5s
Click to check another URL
```

**Interaction:**

- Click: Opens URL input prompt for new check
- Shows duration for last check
- Hover for full URL and details

**When shown:**

- After successful page load
- Screenshot captured (if enabled)
- Detections complete
- No critical errors

**Persistence:** Remains until next check or 30s timeout

### Failed State

**Display:**

```
$(x) Failed
```

**Icon:** X indicates check failure

**Tooltip:**

```
Check failed: https://example.com
Reason: Timeout (30s exceeded)
Click for details in Output channel
```

**Interaction:**

- Click: Opens Output channel with error details
- Shows brief error reason
- Full details available in Output channel

**When shown:**

- Page load timeout
- Network errors
- Browser launch failures
- Invalid URL input
- Permission errors

**Persistence:** Remains until next check or manually clicked

## Configuration

### Enable/Disable Status Bar

**Via Settings UI:**

1. Open Settings (`Cmd/Ctrl + ,`)
2. Search "scrape-le status bar"
3. Toggle "Scrape-le: Statusbar › Enabled"

**Via settings.json:**

```json
{
  "scrape-le.statusBar.enabled": true // default
}
```

**To hide:**

```json
{
  "scrape-le.statusBar.enabled": false
}
```

**Note:** Disabling hides the Status Bar item but does not affect extension functionality.

### Status Bar Priority

**Default priority:** `100` (standard extension priority)

**Relative position:**

- Left side of Status Bar
- Near other extension indicators
- Customizable position by dragging (VS Code 1.60+)

## Status Bar Behavior

### Automatic Updates

Status Bar updates automatically during:

- Check initiation
- Browser launch
- Page load completion
- Detection phase
- Check completion
- Error occurrence

**Update frequency:** Real-time (no polling)

### State Transitions

**Normal flow:**

```
Idle → Checking → Success → Idle (after 30s)
```

**Error flow:**

```
Idle → Checking → Failed → Idle (after click)
```

**Cancel flow:**

```
Checking → Idle (if cancelled via notification)
```

### Multiple Checks

**Behavior:**

- Only one check runs at a time
- Subsequent checks queue automatically
- Status Bar shows current check only

**Example sequence:**

```
Check 1: Checking... → Success
Check 2: Checking... → Failed
Check 3: Checking... → Success
```

## Integration with Other Features

### Output Channel

**When Status Bar shows "Checking...":**

- Output channel shows detailed progress
- View → Output → "Scrape-LE"

**Example Output:**

```
[10:30:15] Check started: https://example.com
[10:30:16] Browser launched
[10:30:18] Page loaded
[10:30:19] Screenshot captured
[10:30:19] Check complete
```

### Notifications

**Notification levels affect Status Bar:**

- `"all"`: Status Bar + notifications for each step
- `"important"`: Status Bar + error/warning notifications
- `"silent"`: Status Bar only (no popup notifications)

**Status Bar always updates** regardless of notification level.

### Commands

**Status Bar triggers commands:**

- Idle click: `scrape-le.checkUrl`
- Failed click: Opens Output channel

**Commands update Status Bar:**

- `scrape-le.checkUrl`: Triggers Checking state
- `scrape-le.checkSelection`: Triggers Checking state

## Status Bar Use Cases

### Quick Reachability Check

**Workflow:**

1. Click Status Bar item
2. Enter URL
3. Watch for state change
4. Success: Continue work
5. Failed: Click for details

**Benefit:** Minimal workflow interruption

### Continuous Monitoring

**Workflow:**

1. Run multiple checks
2. Glance at Status Bar for results
3. Detailed review in Output channel

**Benefit:** Stay in flow while checking multiple URLs

### Visual Progress Indicator

**Workflow:**

1. Start check
2. Monitor spinning icon
3. Switch to other tasks
4. Check back when icon changes

**Benefit:** Non-blocking progress awareness

### Error Detection

**Workflow:**

1. Check fails
2. Status Bar shows Failed state
3. Click for error details
4. Adjust settings/URL
5. Retry

**Benefit:** Quick error awareness and diagnosis

## Status Bar Icons Reference

| Icon           | State    | Meaning           | Action                 |
| -------------- | -------- | ----------------- | ---------------------- |
| `$(globe)`     | Idle     | Ready to check    | Click to start         |
| `$(sync~spin)` | Checking | Check in progress | Wait                   |
| `$(check)`     | Success  | Check succeeded   | Click to check another |
| `$(x)`         | Failed   | Check failed      | Click for details      |

**Icon library:** [Codicons](https://microsoft.github.io/vscode-codicons/dist/codicon.html)

## Troubleshooting Status Bar

### Status Bar not visible

**Check if enabled:**

```json
{
  "scrape-le.statusBar.enabled": true
}
```

**Reload VS Code:**

- `Cmd/Ctrl+Shift+P` → "Developer: Reload Window"

**Check Status Bar visibility:**

- Ensure Status Bar is not hidden globally
- View → Appearance → Show Status Bar

### Status Bar stuck in "Checking..." state

**Causes:**

- Browser process hung
- Extension error
- Very slow page load

**Solutions:**

1. Wait for timeout (check `scrape-le.browser.timeout`)
2. Reload VS Code window
3. Check Output channel for errors
4. Report bug if persistent

### Status Bar not updating

**Check Output channel:**

- May show progress even if Status Bar frozen
- View → Output → "Scrape-LE"

**Reload extension:**

- Disable and re-enable Scrape-LE
- Or reload VS Code window

### Click not working

**Verify state:**

- Clicking during "Checking..." does nothing (expected)
- Only "Idle" and "Failed" states respond to clicks

**Check keybinding conflicts:**

- Status Bar click may conflict with other extensions
- Try command directly: `Cmd/Ctrl+Alt+S`

## Customization

### Hide Status Bar for specific workspaces

**Workspace settings** (`.vscode/settings.json`):

```json
{
  "scrape-le.statusBar.enabled": false
}
```

### Minimize distraction

**Silent notifications + Status Bar only:**

```json
{
  "scrape-le.notificationsLevel": "silent",
  "scrape-le.statusBar.enabled": true
}
```

### Full UI experience

**All notifications + Status Bar:**

```json
{
  "scrape-le.notificationsLevel": "all",
  "scrape-le.statusBar.enabled": true
}
```

## Related Documentation

- [Notifications Guide](NOTIFICATIONS.md) - Notification levels and behavior
- [Commands Guide](COMMANDS.md) - Available commands
- [Configuration Guide](CONFIGURATION.md) - Settings reference

---

**Project:** [Issues](https://github.com/nolindnaidoo/scrape-le/issues) • [Pull Requests](https://github.com/nolindnaidoo/scrape-le/pulls) • [Releases](https://github.com/nolindnaidoo/scrape-le/releases) • [MIT License](LICENSE)

**Dev:** [Spec](SPECIFICATION.md) • [Architecture](ARCHITECTURE.md) • [Development](DEVELOPMENT.md) • [Troubleshooting](TROUBLESHOOTING.md)

**Docs:** [Commands](COMMANDS.md) • [Notifications](NOTIFICATIONS.md) • [Status Bar](STATUSBAR.md) • [Config](CONFIGURATION.md) • [Performance](PERFORMANCE.md) • [Privacy](PRIVACY.md) • [Screenshots](SCREENSHOTS.md) • [Workflow](WORKFLOW.md)
