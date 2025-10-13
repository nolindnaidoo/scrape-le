# Scrape-LE Configuration

Complete guide to configuring Scrape-LE for your workflow.

## Settings Overview

All settings are accessible through VS Code settings (`Cmd/Ctrl + ,`) or by running the command **"Scrape-LE: Open Settings"**.

### Quick Reference

| Setting                             | Type    | Default             | Range/Options          |
| ----------------------------------- | ------- | ------------------- | ---------------------- |
| `scrape-le.browser.timeout`         | number  | `30000`             | 5000-120000 ms         |
| `scrape-le.browser.viewport.width`  | number  | `1280`              | 320-3840 px            |
| `scrape-le.browser.viewport.height` | number  | `720`               | 240-2160 px            |
| `scrape-le.screenshot.enabled`      | boolean | `true`              | true/false             |
| `scrape-le.screenshot.path`         | string  | `.vscode/scrape-le` | Any valid path         |
| `scrape-le.checkConsoleErrors`      | boolean | `true`              | true/false             |
| `scrape-le.notificationsLevel`      | string  | `important`         | all, important, silent |
| `scrape-le.statusBar.enabled`       | boolean | `true`              | true/false             |

## Browser Settings

### Timeout (`scrape-le.browser.timeout`)

**Default**: `30000` (30 seconds)  
**Range**: 5,000 - 120,000 milliseconds

Controls how long the browser waits for a page to load before timing out.

**Use Cases:**

```json
// Fast sites (development, testing)
{
  "scrape-le.browser.timeout": 10000  // 10 seconds
}

// Slow sites (large SPAs, heavy assets)
{
  "scrape-le.browser.timeout": 60000  // 60 seconds
}

// Very slow sites (international, poor connection)
{
  "scrape-le.browser.timeout": 120000  // 120 seconds (maximum)
}
```

**Recommendations:**

- Start with default (30s)
- Increase if you see timeout errors
- Decrease for faster feedback on known-fast sites

### Viewport Width (`scrape-le.browser.viewport.width`)

**Default**: `1280` pixels  
**Range**: 320 - 3840 pixels

Sets the browser window width for rendering pages.

**Common Presets:**

```json
// Mobile
{
  "scrape-le.browser.viewport.width": 375,
  "scrape-le.browser.viewport.height": 667
}

// Tablet
{
  "scrape-le.browser.viewport.width": 768,
  "scrape-le.browser.viewport.height": 1024
}

// Desktop (Default)
{
  "scrape-le.browser.viewport.width": 1280,
  "scrape-le.browser.viewport.height": 720
}

// Large Desktop
{
  "scrape-le.browser.viewport.width": 1920,
  "scrape-le.browser.viewport.height": 1080
}

// 4K
{
  "scrape-le.browser.viewport.width": 3840,
  "scrape-le.browser.viewport.height": 2160
}
```

**Impact:**

- Affects screenshot dimensions
- May trigger responsive design breakpoints
- Larger viewports = larger screenshots

### Viewport Height (`scrape-le.browser.viewport.height`)

**Default**: `720` pixels  
**Range**: 240 - 2160 pixels

Sets the browser window height for rendering pages.

**Note**: Screenshots use `fullPage: true`, so height affects initial viewport only, not final screenshot size.

## Screenshot Settings

### Enable Screenshots (`scrape-le.screenshot.enabled`)

**Default**: `true`

Controls whether to capture full-page screenshots during checks.

```json
// Enable screenshots (default)
{
  "scrape-le.screenshot.enabled": true
}

// Disable screenshots (faster checks)
{
  "scrape-le.screenshot.enabled": false
}
```

**When to Disable:**

- Running many checks quickly
- Don't need visual confirmation
- Limited disk space
- CI/CD environments

### Screenshot Path (`scrape-le.screenshot.path`)

**Default**: `.vscode/scrape-le`

Directory where screenshots are saved.

```json
// Workspace-relative (default)
{
  "scrape-le.screenshot.path": ".vscode/scrape-le"
}

// Project root
{
  "scrape-le.screenshot.path": "screenshots"
}

// Absolute path
{
  "scrape-le.screenshot.path": "/Users/username/screenshots"
}

// OS temp directory
{
  "scrape-le.screenshot.path": "/tmp/scrape-le"
}
```

**Screenshot Naming:**
Screenshots are automatically named: `{hostname}-{date}.png`

Examples:

- `example-com-2025-10-13.png`
- `github-com-2025-10-13.png`

## Console Error Settings

### Check Console Errors (`scrape-le.checkConsoleErrors`)

**Default**: `true`

Captures JavaScript console errors and warnings during page load.

```json
// Capture console errors (default)
{
  "scrape-le.checkConsoleErrors": true
}

// Ignore console errors
{
  "scrape-le.checkConsoleErrors": false
}
```

**What's Captured:**

- Console errors: `console.error()`
- Console warnings: `console.warn()`
- Uncaught exceptions
- Page errors (JavaScript crashes)

**Not Captured:**

- `console.log()`, `console.info()`, `console.debug()`
- Network errors (these are reported separately)

**When to Disable:**

- Sites with expected errors (dev environments)
- Only care about reachability, not JS quality
- Faster checks

## Notification Settings

### Notifications Level (`scrape-le.notificationsLevel`)

**Default**: `important`  
**Options**: `all`, `important`, `silent`

Controls the verbosity of VS Code notifications.

```json
// Show all notifications (info, warnings, errors)
{
  "scrape-le.notificationsLevel": "all"
}

// Show important only (warnings and errors)
{
  "scrape-le.notificationsLevel": "important"
}

// Suppress all notifications (check output channel only)
{
  "scrape-le.notificationsLevel": "silent"
}
```

**Notification Levels:**

| Level       | Info | Warnings | Errors |
| ----------- | ---- | -------- | ------ |
| `all`       | ✅   | ✅       | ✅     |
| `important` | ❌   | ✅       | ✅     |
| `silent`    | ❌   | ❌       | ❌     |

**Recommendations:**

- `important`: Best for most users (default)
- `all`: When you want detailed feedback
- `silent`: For automated scripts or when checking many URLs

## Status Bar Settings

### Status Bar Enabled (`scrape-le.statusBar.enabled`)

**Default**: `true`

Shows/hides the Scrape-LE status bar item.

```json
// Show status bar (default)
{
  "scrape-le.statusBar.enabled": true
}

// Hide status bar
{
  "scrape-le.statusBar.enabled": false
}
```

**Status Bar States:**

- **Idle**: `$(globe) Scrape-LE`
- **Checking**: `$(sync~spin) Checking...`
- **Success**: `$(check) Reachable (1.5s)`
- **Failed**: `$(x) Failed`

## Configuration Profiles

### Profile: Fast Development

Quick checks for local development:

```json
{
  "scrape-le.browser.timeout": 10000,
  "scrape-le.screenshot.enabled": false,
  "scrape-le.checkConsoleErrors": false,
  "scrape-le.notificationsLevel": "silent"
}
```

### Profile: Production Validation

Comprehensive checks for production sites:

```json
{
  "scrape-le.browser.timeout": 60000,
  "scrape-le.screenshot.enabled": true,
  "scrape-le.checkConsoleErrors": true,
  "scrape-le.notificationsLevel": "all",
  "scrape-le.browser.viewport.width": 1920,
  "scrape-le.browser.viewport.height": 1080
}
```

### Profile: Mobile Testing

Check mobile responsiveness:

```json
{
  "scrape-le.browser.viewport.width": 375,
  "scrape-le.browser.viewport.height": 667,
  "scrape-le.screenshot.enabled": true,
  "scrape-le.browser.timeout": 30000
}
```

### Profile: CI/CD

Automated testing without visual output:

```json
{
  "scrape-le.browser.timeout": 30000,
  "scrape-le.screenshot.enabled": false,
  "scrape-le.checkConsoleErrors": true,
  "scrape-le.notificationsLevel": "silent",
  "scrape-le.statusBar.enabled": false
}
```

## Advanced Configuration

### Workspace vs User Settings

**User Settings** (global):

- `Cmd/Ctrl + ,` → Search "scrape-le"
- Applies to all projects

**Workspace Settings** (project-specific):

- `.vscode/settings.json` in your project
- Overrides user settings

Example `.vscode/settings.json`:

```json
{
  "scrape-le.browser.timeout": 45000,
  "scrape-le.screenshot.path": "test-screenshots"
}
```

### Reading Configuration in Code

```typescript
import * as vscode from "vscode";

const config = vscode.workspace.getConfiguration("scrape-le");
const timeout = config.get<number>("browser.timeout") ?? 30000;
```

## Troubleshooting Configuration

### Configuration Not Applied

1. Reload VS Code window (`Cmd/Ctrl + R`)
2. Check for typos in setting names
3. Verify JSON syntax in settings file

### Screenshot Path Issues

- Use forward slashes (`/`) even on Windows
- Ensure directory has write permissions
- Relative paths are relative to workspace root

### Timeout Too Short

Symptoms:

- Frequent timeout errors
- Pages not fully loading

Solution:

```json
{
  "scrape-le.browser.timeout": 60000 // Increase to 60s
}
```

---

**Related Documentation:**

- [Troubleshooting Guide](TROUBLESHOOTING.md)
- [Architecture Guide](ARCHITECTURE.md)
- [Development Guide](DEVELOPMENT.md)

---

**Project:** [Issues](https://github.com/nolindnaidoo/scrape-le/issues) • [Pull Requests](https://github.com/nolindnaidoo/scrape-le/pulls) • [Releases](https://github.com/nolindnaidoo/scrape-le/releases) • [MIT License](LICENSE)

**Dev:** [Spec](SPECIFICATION.md) • [Architecture](ARCHITECTURE.md) • [Development](DEVELOPMENT.md) • [Troubleshooting](TROUBLESHOOTING.md)

**Docs:** [Commands](COMMANDS.md) • [Notifications](NOTIFICATIONS.md) • [Status Bar](STATUSBAR.md) • [Config](CONFIGURATION.md) • [Performance](PERFORMANCE.md) • [Privacy](PRIVACY.md) • [Screenshots](SCREENSHOTS.md) • [Workflow](WORKFLOW.md)
