# Scrape-LE Sample Test URLs

This folder contains sample URLs and test cases to help you understand Scrape-LE's capabilities and get started quickly.

## 🚀 Quick Start

1. Open Command Palette (`Cmd/Ctrl + Shift + P`)
2. Run **"Scrape-LE: Check URL"**
3. Enter any URL from the examples below
4. View results in the output panel

## 📋 Test Cases by Category

### 1. Simple Static Pages

**Purpose**: Fast reachability checks, minimal JavaScript, quick screenshots.

```
https://example.com
https://httpbin.org/html
https://www.ietf.org/rfc/rfc2616.txt
```

**Expected Results:**

- ✅ Load time: 1-3 seconds
- ✅ No console errors
- ✅ Clean screenshot
- ✅ No anti-bot detection

**Use Case**: Basic scraper validation, API endpoint checks, documentation sites.

---

### 2. JavaScript-Heavy SPAs

**Purpose**: Test pages with dynamic content rendering, React/Vue/Angular apps.

```
https://react.dev
https://vuejs.org
https://angular.io
```

**Expected Results:**

- ✅ Load time: 3-8 seconds
- ⚠️ May have minor console warnings (common in SPAs)
- ✅ Full rendered content in screenshot
- ✅ No anti-bot detection

**Use Case**: Verify SPA content is accessible, dynamic content scraping validation.

---

### 3. API Documentation Sites

**Purpose**: Test pages commonly scraped for API reference, documentation.

```
https://jsonplaceholder.typicode.com
https://httpbin.org
https://api.github.com
```

**Expected Results:**

- ✅ Load time: 1-5 seconds
- ✅ Clean JSON/HTML rendering
- ⚠️ May detect rate limiting headers (especially GitHub)
- ✅ Screenshot of API response

**Use Case**: API documentation scraping, endpoint discovery, response format validation.

---

### 4. Rate Limiting Detection

**Purpose**: Test sites with explicit rate limiting headers.

```
https://api.github.com/users/octocat
https://api.github.com/repos/microsoft/vscode
```

**Expected Results:**

- ⚠️ **Rate Limit Detected**:
  - `X-RateLimit-Limit`: 60 requests/hour (unauthenticated)
  - `X-RateLimit-Remaining`: Shows remaining requests
  - `X-RateLimit-Reset`: Unix timestamp for reset
- ✅ Page loads successfully
- ✅ JSON response visible

**Use Case**: Verify rate limits before deploying high-frequency scrapers.

---

### 5. robots.txt Compliance

**Purpose**: Check crawling policies and restrictions.

```
https://www.google.com
https://www.reddit.com
https://www.amazon.com
```

**Expected Results:**

- ✅ robots.txt fetched and parsed
- ⚠️ **Disallow directives**: Many paths restricted
- ⚠️ **Crawl-delay**: May specify delays (e.g., 10 seconds)
- ℹ️ User-agent specific rules shown

**Use Case**: Verify crawling is allowed before deploying scrapers, compliance checking.

---

### 6. Protected Sites (Anti-Bot Detection)

**Purpose**: Identify sites with protection systems.

⚠️ **Note**: These sites may block automated browsers. Use responsibly for testing only.

```
https://www.cloudflare.com (May show Cloudflare detection)
```

**Expected Results:**

- ⚠️ **May detect**: Cloudflare, reCAPTCHA, or other protection
- ⚠️ Load time: 10-30 seconds (challenge pages)
- ⚠️ May show challenge page in screenshot
- ⚠️ Console errors possible

**Use Case**: Identify protection systems before scraper development, plan bypass strategies.

---

### 7. Authentication Walls

**Purpose**: Detect login requirements.

```
https://github.com/settings/profile (Requires login)
```

**Expected Results:**

- ⚠️ **Authentication Detected**:
  - HTTP 401/403 status OR
  - Login form present OR
  - "Sign in" keywords detected
- ⚠️ Redirect to login page possible
- ✅ Screenshot shows login page

**Use Case**: Identify authentication requirements, plan credential handling.

---

### 8. Large/Heavy Pages

**Purpose**: Test performance with large pages, many assets.

```
https://www.wikipedia.org
https://www.nytimes.com
```

**Expected Results:**

- ⚠️ Load time: 5-15 seconds
- ⚠️ Many network requests
- ⚠️ Large screenshot file size
- ⚠️ Some console warnings common

**Use Case**: Performance testing, timeout configuration validation.

---

### 9. Mobile vs Desktop Rendering

**Purpose**: Test viewport configuration.

**Test Steps:**

1. Check same URL with different viewport settings
2. Compare screenshots

**Settings to Try:**

```json
{
  "scrape-le.browser.viewport.width": 375,
  "scrape-le.browser.viewport.height": 667
}
```

**Recommended URLs:**

```
https://m.wikipedia.org (Mobile-optimized)
https://www.bbc.com (Responsive design)
```

**Use Case**: Verify mobile vs desktop content differences, responsive design validation.

---

### 10. Localhost Testing

**Purpose**: Test local development servers.

```
http://localhost:3000
http://localhost:8080
http://127.0.0.1:5000
```

**Expected Results:**

- ✅ Works with local servers
- ✅ Fast response (local network)
- ✅ Development console errors visible
- ✅ Great for pre-deployment testing

**Use Case**: Test your own scrapers before deploying, local development validation.

---

## 🎯 Configuration Recommendations

### Quick Checks (Development)

```json
{
  "scrape-le.browser.timeout": 10000,
  "scrape-le.screenshot.enabled": false,
  "scrape-le.detections.antiBot": false,
  "scrape-le.detections.rateLimit": false,
  "scrape-le.detections.robotsTxt": false,
  "scrape-le.notificationsLevel": "silent"
}
```

### Full Validation (Pre-Production)

```json
{
  "scrape-le.browser.timeout": 30000,
  "scrape-le.screenshot.enabled": true,
  "scrape-le.detections.antiBot": true,
  "scrape-le.detections.rateLimit": true,
  "scrape-le.detections.robotsTxt": true,
  "scrape-le.detections.authentication": true,
  "scrape-le.notificationsLevel": "important"
}
```

### High-Security Sites

```json
{
  "scrape-le.browser.timeout": 60000,
  "scrape-le.screenshot.enabled": true,
  "scrape-le.checkConsoleErrors": true,
  "scrape-le.detections.antiBot": true,
  "scrape-le.notificationsLevel": "all"
}
```

---

## ⚠️ Important Notes

### Ethical Scraping

- Always check `robots.txt` before scraping
- Respect rate limits
- Don't overload servers
- Follow website terms of service
- Use scraping responsibly and legally

### Testing Best Practices

- Start with simple, known-good URLs
- Test with your actual target sites before deploying
- Configure appropriate timeouts for your use case
- Use screenshots to verify content loads correctly
- Check console errors for JavaScript issues

### Privacy & Security

- All checks run locally on your machine
- No data sent to external services
- URLs are only visited by your local browser
- Screenshots saved locally only

---

## 🆘 Troubleshooting

**Check Fails Immediately:**

- Verify URL is accessible in regular browser
- Check your internet connection
- Increase timeout setting

**Screenshot Not Saved:**

- Check `scrape-le.screenshot.path` setting
- Verify directory has write permissions
- Enable screenshots: `scrape-le.screenshot.enabled: true`

**Anti-Bot Detection Not Working:**

- Enable detection: `scrape-le.detections.antiBot: true`
- Some systems only detectable server-side
- Try multiple protected sites to verify

---

## 📚 Additional Resources

- **Main README**: [../README.md](../README.md)
- **Configuration Guide**: [../docs/CONFIGURATION.md](../docs/CONFIGURATION.md)
- **Troubleshooting**: [../docs/TROUBLESHOOTING.md](../docs/TROUBLESHOOTING.md)
- **GitHub Issues**: [Report problems or request features](https://github.com/nolindnaidoo/scrape-le/issues)

---

**Happy Scraping! 🚀**
