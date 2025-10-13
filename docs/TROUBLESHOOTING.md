# Scrape-LE Troubleshooting

Common issues and their solutions.

## Browser Installation Issues

### Error: "Executable doesn't exist"

**Symptom:**

```
browserType.launch: Executable doesn't exist at
/Users/username/Library/Caches/ms-playwright/chromium-1194/chrome-mac/headless_shell
```

**Cause:** Playwright's Chromium browser is not installed.

**Solution 1: Automatic Installation**

1. Run any check command
2. Click "Install Chromium" when prompted
3. Wait for installation to complete (~130MB download)

**Solution 2: Manual Installation**

```bash
cd /Users/nnaidoo/dev/vscode-extensions/scrape-le
bunx playwright install chromium
```

**Solution 3: Setup Command**

1. Open Command Palette (`Cmd/Ctrl + Shift + P`)
2. Run "Scrape-LE: Setup Browser"
3. Choose "Install Chromium Browser"

### Error: "Failed to launch browser"

**Symptoms:**

- Browser won't start
- Generic launch errors

**Common Causes:**

**1. Insufficient Permissions**

```bash
# macOS/Linux: Check permissions
ls -la ~/Library/Caches/ms-playwright
chmod +x ~/Library/Caches/ms-playwright/chromium-*/chrome-mac/headless_shell
```

**2. Corrupted Installation**

```bash
# Remove and reinstall
rm -rf ~/Library/Caches/ms-playwright/chromium-*
bunx playwright install chromium
```

**3. Antivirus Blocking**

- Add Playwright directory to antivirus exclusions
- Temporarily disable antivirus and retry

### Browser Installation Hangs

**Symptom:** Installation progress freezes.

**Solutions:**

1. Cancel and retry with better internet connection
2. Use manual installation with verbose output:

```bash
DEBUG=pw:install bunx playwright install chromium
```

3. Clear Bun cache and retry:

```bash
rm -rf ~/.bun/install/cache
bunx playwright install chromium
```

## Navigation and Network Errors

### Timeout Errors

**Error Message:**

```
⏱️ Timeout: Navigation timeout of 30000ms exceeded
```

**Causes:**

- Page loads slowly
- Server is slow to respond
- Heavy JavaScript/assets
- Network latency

**Solutions:**

**1. Increase Timeout**

```json
{
  "scrape-le.browser.timeout": 60000 // 60 seconds
}
```

**2. Check Network Connection**

```bash
# Test direct connection
curl -I https://example.com
ping example.com
```

**3. Try Different Network**

- Switch from Wi-Fi to Ethernet
- Disable VPN
- Try from different location

### DNS / Network Errors

**Error Messages:**

```
🔌 Network error: net::ERR_NAME_NOT_RESOLVED
🔌 Network error: net::ERR_CONNECTION_REFUSED
🔌 Network error: net::ERR_CONNECTION_TIMED_OUT
```

**Solutions:**

**ERR_NAME_NOT_RESOLVED:**

```bash
# Verify domain exists
nslookup example.com

# Try with different DNS
# macOS/Linux: Edit /etc/resolv.conf
nameserver 8.8.8.8
nameserver 8.8.4.4
```

**ERR_CONNECTION_REFUSED:**

- Verify server is running
- Check firewall settings
- Confirm correct port

**ERR_CONNECTION_TIMED_OUT:**

- Check network connectivity
- Verify server is accessible
- Disable firewall temporarily

### SSL/Certificate Errors

**Error:**

```
net::ERR_CERT_AUTHORITY_INVALID
net::ERR_CERT_DATE_INVALID
```

**Causes:**

- Self-signed certificates
- Expired certificates
- Untrusted certificate authority

**Solutions:**

- Use HTTP instead of HTTPS (if appropriate)
- Fix certificate on server side
- For local development, accept self-signed certs

## Screenshot Issues

### Screenshots Not Saving

**Check 1: Path Exists**

```bash
# Verify directory exists and is writable
ls -la .vscode/scrape-le/
mkdir -p .vscode/scrape-le
```

**Check 2: Permissions**

```bash
# macOS/Linux: Fix permissions
chmod 755 .vscode/scrape-le
```

**Check 3: Disk Space**

```bash
# Check available disk space
df -h
```

**Check 4: Setting Enabled**

```json
{
  "scrape-le.screenshot.enabled": true
}
```

### Screenshot Path Issues

**Symptom:** Screenshots save to unexpected location.

**Solution:** Use absolute paths for clarity:

```json
{
  "scrape-le.screenshot.path": "/Users/username/screenshots"
}
```

**Verify actual path:**

1. Check output panel after a check
2. Look for "Screenshot: /path/to/file.png"

### Large Screenshot Files

**Symptom:** Screenshots are very large (>10MB).

**Causes:**

- Very tall pages
- High resolution images
- Complex layouts

**Solutions:**

1. Reduce viewport size:

```json
{
  "scrape-le.browser.viewport.width": 1024,
  "scrape-le.browser.viewport.height": 768
}
```

2. Disable screenshots if not needed:

```json
{
  "scrape-le.screenshot.enabled": false
}
```

## Console Error Detection

### Console Errors Not Captured

**Check 1: Feature Enabled**

```json
{
  "scrape-le.checkConsoleErrors": true
}
```

**Check 2: Timing**

- Console errors are only captured during page load
- Errors after `networkidle` event may be missed

**Check 3: Error Type**

- Only `console.error()` and `console.warn()` are captured
- `console.log()` is not captured

### Too Many Console Errors

**Symptom:** Long list of console errors overwhelming output.

**Common Causes:**

- Development sites with debug logging
- Known third-party script errors
- Browser security warnings

**Solutions:**

**1. Disable Console Error Checking**

```json
{
  "scrape-le.checkConsoleErrors": false
}
```

**2. Review and Filter**

- Check output panel for details
- Ignore known/expected errors
- Focus on critical errors only

## Performance Issues

### Slow Checks

**Symptoms:**

- Checks take >30 seconds
- Extension feels sluggish

**Causes & Solutions:**

**1. Slow Internet:**

- Increase timeout
- Check on faster connection

**2. Heavy Pages:**

```json
{
  "scrape-le.browser.timeout": 60000
}
```

**3. Screenshot Overhead:**

```json
{
  "scrape-le.screenshot.enabled": false // Faster
}
```

**4. Console Error Collection:**

```json
{
  "scrape-le.checkConsoleErrors": false // Slightly faster
}
```

### Memory Issues

**Symptom:** VS Code becomes slow or crashes.

**Causes:**

- Many checks in quick succession
- Browser instances not cleaning up
- Large screenshots accumulating

**Solutions:**

**1. Restart VS Code**

```
Cmd/Ctrl + R
```

**2. Clear Screenshots**

```bash
rm -rf .vscode/scrape-le/*.png
```

**3. Check Browser Processes**

```bash
# macOS/Linux: Kill stray chrome processes
ps aux | grep chrome | grep -v grep
killall -9 chrome
```

## Command and UI Issues

### Commands Not Appearing

**Symptom:** Can't find Scrape-LE commands in Command Palette.

**Solutions:**

**1. Reload Window**

```
Cmd/Ctrl + R
```

**2. Check Extension Activated**

- View → Extensions
- Search "Scrape-LE"
- Verify it's enabled

**3. Check Activation Events**

- Extension should activate on first command use
- Check Output → Extension Host for errors

### Status Bar Not Visible

**Check Setting:**

```json
{
  "scrape-le.statusBar.enabled": true
}
```

**Verify Status Bar Space:**

- Status bar may be hidden if too many items
- Right-click status bar → Manage items

### Notifications Not Appearing

**Check Level:**

```json
{
  "scrape-le.notificationsLevel": "important" // or "all"
}
```

**Note:** On `silent` mode, check Output panel instead.

## VS Code Integration Issues

### Extension Won't Install

**Symptom:** Installation fails or hangs.

**Solutions:**

**1. Check VS Code Version**

- Requires VS Code 1.105.0+
- Update VS Code if needed

**2. Check Node Version**

- Requires Node.js 20.0.0+
- Run `node --version`

**3. Clear Extension Cache**

```bash
rm -rf ~/.vscode/extensions/nolindnaidoo.scrape-le-*
```

**4. Manual Installation**

```bash
# Install .vsix manually
code --install-extension scrape-le-0.1.0.vsix
```

### Extension Conflicts

**Symptom:** Other extensions interfere with Scrape-LE.

**Identify Conflict:**

1. Disable all other extensions
2. Test Scrape-LE
3. Re-enable extensions one-by-one

**Common Conflicts:**

- Other Playwright extensions
- Browser automation tools
- Screenshot extensions

## Getting Help

### Before Reporting Issues

1. **Check this guide** for common solutions
2. **Review output panel:** View → Output → Scrape-LE
3. **Check extension logs:** Help → Toggle Developer Tools
4. **Try in clean environment:** Disable other extensions

### Reporting Bugs

Include:

1. VS Code version (`Help → About`)
2. Extension version (`Extensions → Scrape-LE → Details`)
3. Operating system and version
4. Error messages from output panel
5. Steps to reproduce
6. Example URL (if not sensitive)

**GitHub Issues:**
https://github.com/nolindnaidoo/scrape-le/issues

### Debug Mode

Enable verbose logging:

```typescript
// Check developer console (Help → Toggle Developer Tools)
// Look for Scrape-LE messages
```

## Quick Fixes

### Complete Reset

```bash
# 1. Remove Playwright cache
rm -rf ~/Library/Caches/ms-playwright

# 2. Reinstall browser
cd <workspace>
bunx playwright install chromium

# 3. Reload VS Code
# Cmd/Ctrl + R
```

### Clean Installation Test

```bash
# Create test workspace
mkdir test-scrape-le
cd test-scrape-le
code .

# Install extension
# Test with: https://example.com
```

---

**Related Documentation:**

- [Configuration Guide](CONFIGURATION.md)
- [Architecture Guide](ARCHITECTURE.md)
- [Testing Guide](TESTING.md)
- [Development Guide](DEVELOPMENT.md)


---
**Project:** [Issues](https://github.com/nolindnaidoo/scrape-le/issues) • [Pull Requests](https://github.com/nolindnaidoo/scrape-le/pulls) • [Releases](https://github.com/nolindnaidoo/scrape-le/releases) • [MIT License](LICENSE)

**Dev:** [Spec](SPECIFICATION.md) • [Architecture](ARCHITECTURE.md) • [Development](DEVELOPMENT.md) • [Troubleshooting](TROUBLESHOOTING.md)

**Docs:** [Commands](COMMANDS.md) • [Notifications](NOTIFICATIONS.md) • [Status Bar](STATUSBAR.md) • [Config](CONFIGURATION.md) • [Performance](PERFORMANCE.md) • [Privacy](PRIVACY.md) • [Screenshots](SCREENSHOTS.md) • [Workflow](WORKFLOW.md)
