# Scrape‑LE Privacy & Security Guide

## Philosophy

- Privacy‑first by design: minimal data collection, local-only processing.
- Minimal network access: only connects to URLs you explicitly check.
- Safe defaults: telemetry is off; no background data collection.
- Transparency: this document enumerates all relevant data flows and controls.

Non‑goals:

- Remote telemetry or analytics.
- Background scanning or automatic checks.
- Data aggregation or usage tracking.

---

## What data Scrape‑LE handles

Scrape‑LE operates locally within VS Code with controlled network access. Typical data interactions:

- **URL inputs**: User-provided URLs are validated and sent only to the target sites for checking.
- **Screenshots**: Full-page screenshots captured and saved locally to configured directory.
- **Console logs**: JavaScript console errors/warnings captured during page load.
- **HTTP responses**: Response headers analyzed for rate limiting and anti-bot detection.
- **robots.txt**: Fetched from target sites to check crawling policies.
- **Configuration values**: Read from `scrape-le.*` settings to control behavior.
- **Output presentation**: Results displayed in Output channel and Status Bar.

Data sources intentionally not used:

- No background network access (only checks when explicitly triggered).
- No persistent storage beyond screenshots and cached browser installation.
- No workspace scanning or file system access beyond configuration.
- No remote telemetry, analytics, or usage tracking.

---

## Network access

Scrape‑LE makes network requests only when explicitly checking URLs:

- **Target URL**: Navigates to user-provided URL via Chromium browser.
- **robots.txt**: Fetches `robots.txt` from target site when detection is enabled.
- **Browser resources**: Chromium downloads page resources (HTML, CSS, JS, images) as normal.
- **Chromium installation**: One-time download of Chromium browser (~130MB) during setup.

All network access is:

- User-initiated (triggered by Check URL or Check Selection commands)
- Target-specific (only connects to URLs you provide)
- Transparent (results shown in Output channel)

No network access for:

- Telemetry or analytics
- Update checks (handled by VS Code Marketplace)
- Background data collection
- Usage tracking

Audit tip: The extension uses Playwright's Chromium browser for all web requests. Review `src/scraper/checker.ts` for network behavior.

---

## Telemetry policy (local‑only)

Scrape‑LE includes optional, local‑only logging to aid troubleshooting. When enabled, messages are written to a VS Code Output channel named "Scrape-LE". They are not transmitted over any network.

Key properties:

- **Opt‑in**: Controlled by `scrape-le.notificationsLevel: "all"` (default `"important"`).
- **Local‑only**: Messages appear in the Output panel and stay on your machine.
- **Minimal content**: Event names and operational data (URLs, durations, detection results); never includes sensitive content.
- **Ephemeral**: Output channel text is not persisted by the extension and does not survive VS Code restarts.

Implementation approach:

```typescript
// Output to local channel only, never sent over network
outputChannel.appendLine(`[${timestamp}] ${message}`);
```

See: `src/ui/output.ts` for output formatting.

---

## Screenshot storage

Screenshots are stored locally on your machine:

- **Default location**: `.vscode/scrape-le/` (workspace-relative)
- **Naming convention**: `{hostname}-{date}.png`
- **Control**: Configurable via `scrape-le.screenshot.path`
- **Opt-out**: Set `scrape-le.screenshot.enabled: false` to disable

Screenshot data:

- Stored as PNG files on local filesystem
- Never transmitted over network
- Can be deleted manually at any time
- Permissions match your filesystem settings

Risk note: Screenshots may contain sensitive information from target pages. Store in secure locations if checking authenticated or private pages.

---

## Browser data & caching

Chromium browser behavior:

- **Installation**: Chromium installed to `~/Library/Caches/ms-playwright` (macOS) or equivalent
- **Browser cache**: Temporary browser data stored in OS cache directories
- **Cookies**: Not persisted between checks; each check starts fresh
- **Local storage**: Cleared between checks; no persistent storage
- **Sessions**: Each check runs in isolated browser context

Browser data is:

- Temporary and isolated per check
- Not shared between checks
- Automatically cleaned up after check completes
- Managed by Playwright browser automation

---

## Storage & retention

- **Persistent storage**: Screenshots only (configurable location).
- **Output channel**: Ephemeral strings shown in VS Code Output panel when enabled; not persisted by the extension.
- **Settings**: Stored by VS Code in your user/workspace settings as usual; the extension only reads them.
- **Browser cache**: Managed by Playwright; temporary and isolated.

---

## Permissions, workspace trust, and virtual workspaces

- **Workspace Trust**: Supported with full functionality. Extension requires network access for checking URLs.
- **Virtual workspaces**: Supported with limitations (requires local filesystem for screenshots).
- **Network permission**: Required for checking URLs and downloading Chromium.
- **Filesystem permission**: Required for saving screenshots and caching browser.
- **No shell execution**: Extension does not execute external commands or scripts.

---

## Security practices

- **URL validation**: All user-provided URLs are validated before use.
- **Input sanitization**: URL inputs are sanitized to prevent injection attacks.
- **Browser isolation**: Each check runs in isolated browser context with cleared state.
- **Screenshot security**: Screenshots saved with restricted permissions.
- **Error handling**: All errors caught and handled gracefully; no sensitive data in error messages.
- **Timeout protection**: Configurable timeouts prevent runaway browser processes.
- **Resource cleanup**: Browser instances and resources properly disposed after each check.

---

## Threat model (abridged)

In scope:

- **Network access control**: Mitigated by explicit user-triggered checks only.
- **Screenshot exposure**: Mitigated by local-only storage with user-controlled paths.
- **Browser security**: Mitigated by using Chromium with latest security patches.
- **Data persistence**: Mitigated by minimal storage (screenshots only) and no remote access.

Out of scope:

- **Target site behavior**: Extension cannot control what target sites do with requests.
- **OS‑level access**: Screenshots stored in filesystem are accessible to other local applications.
- **Browser vulnerabilities**: Chromium security depends on Playwright's browser version.

---

## Auditing & verification

Recommended checks for maintainers and security‑conscious users:

- **Code search**: Verify network access is limited to checking user-provided URLs.
- **Dependency review**: Ensure Playwright and dependencies are up to date.
- **Output inspection**: Enable verbose logging with `scrape-le.notificationsLevel: "all"` and observe Output panel.
- **Screenshot audit**: Check configured screenshot directory for stored files.
- **Network monitoring**: Use OS-level network monitoring to verify no unexpected connections.

---

## Related settings

- `scrape-le.notificationsLevel` (string, default `"important"`): Controls output verbosity; `"all"` enables detailed logging.
- `scrape-le.screenshot.enabled` (boolean, default `true`): Controls screenshot capture.
- `scrape-le.screenshot.path` (string, default `".vscode/scrape-le"`): Configures screenshot storage location.
- `scrape-le.detections.*` (boolean): Controls which detection features are enabled.
- `scrape-le.browser.timeout` (number, default `30000`): Timeout protection for page loads.

See `CONFIGURATION.md` for full details.

---

## FAQ

**Q: Does Scrape‑LE send any data over the network?**

- A: Only to URLs you explicitly check. No telemetry, analytics, or remote data collection.

**Q: Are screenshots stored locally or sent anywhere?**

- A: Screenshots are stored locally only. They are never transmitted over the network.

**Q: Can I disable all network access?**

- A: No, network access is required for the extension's core functionality (checking URLs). However, all network access is user-initiated and target-specific.

**Q: Are my checked URLs tracked or logged?**

- A: URLs appear in the local Output channel when verbose logging is enabled. They are never sent to any external service.

**Q: Can other applications access my screenshots?**

- A: Yes, screenshots are stored as regular files on your filesystem. Treat them with appropriate security measures.

**Q: Does the extension collect usage analytics?**

- A: No. There is no usage tracking, analytics, or telemetry of any kind.

---

## Reporting security or privacy issues

- Open an issue in the GitHub repository with a clear description and reproduction steps.
- For sensitive disclosures, contact the maintainer via GitHub profile.
- Security patches will be released as quickly as possible.

---

**Project:** [Issues](https://github.com/nolindnaidoo/scrape-le/issues) • [Pull Requests](https://github.com/nolindnaidoo/scrape-le/pulls) • [Releases](https://github.com/nolindnaidoo/scrape-le/releases) • [MIT License](LICENSE)

**Dev:** [Spec](SPECIFICATION.md) • [Architecture](ARCHITECTURE.md) • [Development](DEVELOPMENT.md) • [Troubleshooting](TROUBLESHOOTING.md)

**Docs:** [Commands](COMMANDS.md) • [Notifications](NOTIFICATIONS.md) • [Status Bar](STATUSBAR.md) • [Config](CONFIGURATION.md) • [Performance](PERFORMANCE.md) • [Privacy](PRIVACY.md) • [Screenshots](SCREENSHOTS.md) • [Workflow](WORKFLOW.md)
