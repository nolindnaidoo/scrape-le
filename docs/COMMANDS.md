## Scrape‑LE Commands Guide

This document describes all commands exposed by the Scrape‑LE VS Code extension in an API-style format. Each command lists its identifier, availability, keybinding (if any), behavior, preconditions, prompts/inputs, outputs/side effects, related settings, and expected warnings/errors.

### Where to run

- Command Palette: View → Command Palette → search for "Scrape‑LE" (macOS: Cmd+Shift+P, Windows/Linux: Ctrl+Shift+P)
- Keyboard shortcuts: when provided (see Quick reference)
- Status Bar: Click the Scrape‑LE status bar item

### Quick reference

| Command         | Identifier                 | Keybinding                                   | Where available              | Description                                                                                                               |
| --------------- | -------------------------- | -------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Check URL       | `scrape-le.checkUrl`       | macOS: `cmd+alt+s` • Win/Linux: `ctrl+alt+s` | Command; Status Bar          | Prompts for a URL and checks its scrapeability. Captures screenshot, console errors, and runs enabled detection features. |
| Check Selection | `scrape-le.checkSelection` | —                                            | Command; Editor context menu | Checks the currently selected text as a URL. Quick way to verify URLs found in code or documentation.                     |
| Setup Browser   | `scrape-le.setupBrowser`   | —                                            | Command                      | Installs Chromium browser if not present. Verifies installation and runs a test check.                                    |
| Open Settings   | `scrape-le.openSettings`   | —                                            | Command                      | Opens the Settings UI filtered to `scrape-le.*`.                                                                          |

---

## Detailed commands

### Check URL

- **Identifier**: `scrape-le.checkUrl`
- **Keybinding**: macOS `cmd+alt+s`, Windows/Linux `ctrl+alt+s`
- **Availability**:
  - Command Palette
  - Status Bar (click globe icon)
  - Requires Chromium to be installed
- **Behavior**:
  - Prompts for URL input with validation
  - Launches headless Chromium browser
  - Navigates to URL with configured timeout
  - Captures full-page screenshot (if enabled)
  - Collects console errors and warnings (if enabled)
  - Runs enabled detection features:
    - Anti-bot detection (Cloudflare, reCAPTCHA, hCaptcha, DataDome, Perimeter81)
    - Rate limiting detection (response headers)
    - robots.txt compliance check
    - Authentication wall detection (login forms, 401/403 status)
  - Displays results in Output channel
  - Updates Status Bar with result
- **Related settings**:
  - `scrape-le.browser.timeout`
  - `scrape-le.browser.viewport.width`, `scrape-le.browser.viewport.height`
  - `scrape-le.screenshot.enabled`, `scrape-le.screenshot.path`
  - `scrape-le.checkConsoleErrors`
  - `scrape-le.detections.antiBot`, `scrape-le.detections.rateLimit`
  - `scrape-le.detections.robotsTxt`, `scrape-le.detections.authentication`
  - `scrape-le.notificationsLevel`
  - `scrape-le.statusBar.enabled`
- **Preconditions**:
  - Chromium must be installed (prompts to run Setup Browser if missing)
  - Valid network connection
  - URL must be well-formed (http:// or https://)
- **Prompts/Inputs**:
  - URL input with validation
  - May prompt to install Chromium if not found
- **Outputs/Side effects**:
  - Detailed check results in Output channel → "Scrape-LE"
  - Screenshot saved to configured path (if enabled)
  - Status Bar updated with result and duration
  - Notifications based on `notificationsLevel` setting
- **Warnings/Errors**:
  - Timeout errors if page takes too long to load
  - Network errors for unreachable URLs
  - Browser launch errors if Chromium is corrupted
  - Permission errors if screenshot path is not writable
- **Telemetry (local-only)**:
  - Emits operation start/finish events to Output channel when `notificationsLevel: "all"`

### Check Selection

- **Identifier**: `scrape-le.checkSelection`
- **Availability**:
  - Command Palette (requires active editor with selection)
  - Editor context menu (requires text selection)
- **Behavior**:
  - Reads currently selected text from active editor
  - Validates selection as URL
  - Runs same check process as Check URL command
- **Related settings**:
  - Same as Check URL command
- **Preconditions**:
  - Active text editor with selected text
  - Selected text must be valid URL
  - Chromium must be installed
- **Prompts/Inputs**:
  - None (uses current selection)
  - May prompt to install Chromium if not found
- **Outputs/Side effects**:
  - Same as Check URL command
- **Warnings/Errors**:
  - Error if no text is selected
  - Error if selected text is not a valid URL
  - Same errors as Check URL command
- **Telemetry (local-only)**:
  - Emits selection check events when enabled

### Setup Browser

- **Identifier**: `scrape-le.setupBrowser`
- **Availability**: Command Palette
- **Behavior**:
  - Detects if Chromium is already installed
  - If not installed, downloads and installs Chromium (~130MB)
  - Verifies installation by attempting to launch browser
  - Optionally runs test check to verify functionality
  - Shows progress dialog during installation
- **Related settings**: None
- **Preconditions**:
  - Network connection (for downloading Chromium)
  - Write permissions in cache directory
  - ~200MB free disk space
- **Prompts/Inputs**:
  - Confirmation before downloading Chromium
  - Optional test URL after installation
- **Outputs/Side effects**:
  - Chromium installed to `~/Library/Caches/ms-playwright` (macOS)
  - Progress notifications during download
  - Success notification on completion
- **Warnings/Errors**:
  - Network errors during download
  - Permission errors if cache directory is not writable
  - Installation failures if disk space is insufficient
- **Telemetry (local-only)**:
  - Emits setup start/finish events when enabled

### Open Settings

- **Identifier**: `scrape-le.openSettings`
- **Availability**: Command Palette
- **Behavior**: Opens the Settings UI filtered to `scrape-le.*` for quick access to all extension settings.
- **Preconditions**: None
- **Prompts/Inputs**: None
- **Outputs/Side effects**: Opens Settings UI
- **Warnings/Errors**: None

---

## Examples

- Check via keybinding: Press `Cmd+Alt+S` / `Ctrl+Alt+S` and enter URL.
- Check via Status Bar: Click the `$(globe) Scrape-LE` item in Status Bar.
- Check selected URL: Select a URL in editor, right-click → "Scrape-LE: Check Selection".
- Setup browser: Run "Scrape-LE: Setup Browser" from Command Palette on first use.

## Command return conventions

- Commands do not return values; results are presented in the Output channel and Status Bar.
- All operations show progress with cancellation support where applicable.

---

**Project:** [Issues](https://github.com/nolindnaidoo/scrape-le/issues) • [Pull Requests](https://github.com/nolindnaidoo/scrape-le/pulls) • [Releases](https://github.com/nolindnaidoo/scrape-le/releases) • [MIT License](LICENSE)

**Dev:** [Spec](SPECIFICATION.md) • [Architecture](ARCHITECTURE.md) • [Development](DEVELOPMENT.md) • [Troubleshooting](TROUBLESHOOTING.md)

**Docs:** [Commands](COMMANDS.md) • [Notifications](NOTIFICATIONS.md) • [Status Bar](STATUSBAR.md) • [Config](CONFIGURATION.md) • [Performance](PERFORMANCE.md) • [Privacy](PRIVACY.md) • [Screenshots](SCREENSHOTS.md) • [Workflow](WORKFLOW.md)
