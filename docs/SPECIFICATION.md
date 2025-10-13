# Scrape‑LE Technical Specification

This document provides the technical specification for Scrape‑LE, including requirements, design decisions, and implementation details.

## Overview

**Extension Name:** Scrape-LE  
**Purpose:** Verify web page scrapeability before deploying scrapers  
**Primary Use Case:** Pre-deployment validation of scraper target URLs  
**Target Users:** Web scraper developers, automation engineers, QA testers

## Core Requirements

### Functional Requirements

**FR1: URL Reachability Checking**

- System shall navigate to user-provided URLs using a real browser
- System shall report whether URLs are accessible
- System shall measure and report page load duration
- System shall handle HTTP/HTTPS protocols

**FR2: Visual Confirmation**

- System shall capture full-page screenshots of rendered pages
- System shall save screenshots to configurable local directory
- System shall support viewports from 320x240 to 3840x2160 pixels
- Screenshots shall capture JavaScript-rendered content

**FR3: Console Error Detection**

- System shall capture JavaScript console errors during page load
- System shall capture console warnings
- System shall report error count and messages
- Console monitoring shall be optional (configurable)

**FR4: Anti-Bot Detection**

- System shall detect common anti-bot systems:
  - Cloudflare (headers, server string, scripts)
  - reCAPTCHA (v2, v3, Enterprise)
  - hCaptcha (scripts, DOM elements)
  - DataDome (headers, scripts)
  - Perimeter81 (headers, scripts)
- Detection shall use multiple heuristics per system
- False positives shall be minimized through combined checks

**FR5: Rate Limiting Detection**

- System shall detect rate limiting via HTTP response headers
- System shall support standard rate limit headers:
  - `X-RateLimit-*` (GitHub, Twitter style)
  - `RateLimit-*` (RFC draft style)
  - `Retry-After` (standard HTTP)
- System shall extract limit, remaining, and reset values

**FR6: robots.txt Compliance Checking**

- System shall fetch and parse robots.txt files
- System shall extract:
  - User-agent directives
  - Disallow rules
  - Allow rules
  - Crawl-delay directives
  - Sitemap URLs
- System shall timeout robots.txt fetches after 5 seconds

**FR7: Authentication Wall Detection**

- System shall detect authentication requirements via:
  - HTTP 401/403 status codes
  - Login form presence (password inputs)
  - Authentication-related keywords in content
- System shall combine multiple signals for accuracy

**FR8: Configuration Management**

- System shall provide VS Code settings for all features
- System shall support workspace-specific configuration
- System shall validate all configuration values
- System shall provide sensible defaults

### Non-Functional Requirements

**NFR1: Performance**

- Simple page checks shall complete in 1-3 seconds
- Complex page checks shall complete in 10-30 seconds
- System shall support configurable timeouts (5-120 seconds)
- Memory usage shall not exceed 500MB during checks

**NFR2: Reliability**

- System shall handle network failures gracefully
- System shall timeout hung browser processes
- System shall cleanup resources after each check
- System shall never crash VS Code

**NFR3: Usability**

- Commands shall be accessible via Command Palette
- Status Bar shall provide real-time feedback
- Output channel shall provide detailed results
- Error messages shall be clear and actionable

**NFR4: Privacy**

- System shall not collect telemetry
- System shall only connect to user-specified URLs
- Screenshots shall be stored locally only
- No data shall be transmitted to external services

**NFR5: Compatibility**

- System shall support VS Code 1.105.0+
- System shall run on Windows, macOS, and Linux
- System shall use Bun runtime for development
- System shall use Playwright Chromium for browser automation

## Architecture

### Component Structure

```
scrape-le/
├── src/
│   ├── extension.ts          # Extension activation
│   ├── types.ts               # Type definitions
│   ├── commands/
│   │   ├── check.ts          # Main check command
│   │   ├── checkSelection.ts # Check selected URL
│   │   └── setup.ts          # Browser setup
│   ├── config/
│   │   └── config.ts         # Configuration management
│   ├── detectors/
│   │   ├── index.ts          # Detection orchestration
│   │   ├── antibot.ts        # Anti-bot detection
│   │   ├── ratelimit.ts      # Rate limit detection
│   │   ├── robotstxt.ts      # robots.txt parsing
│   │   └── authentication.ts # Auth wall detection
│   ├── scraper/
│   │   ├── browser.ts        # Browser management
│   │   ├── checker.ts        # Core check logic
│   │   └── install.ts        # Chromium installation
│   ├── ui/
│   │   ├── output.ts         # Output channel
│   │   ├── statusBar.ts      # Status Bar integration
│   │   └── notifier.ts       # Notifications
│   └── utils/
│       ├── url.ts            # URL validation
│       └── errorHandling.ts  # Error utilities
```

### Data Flow

```
User Input → URL Validation → Browser Launch → Page Load
    ↓                                              ↓
Command → Check Options → Screenshot Capture → Detections
    ↓                            ↓                  ↓
Config → Browser Settings → Console Monitoring → Results
    ↓                            ↓                  ↓
Output → Status Bar Update → Notifications → Cleanup
```

### Key Interfaces

**CheckOptions:**

```typescript
interface CheckOptions {
  readonly url: string;
  readonly timeout: number;
  readonly viewport: Readonly<{ width: number; height: number }>;
  readonly screenshotEnabled: boolean;
  readonly screenshotPath: string;
  readonly checkConsoleErrors: boolean;
  readonly detections: Readonly<{
    antiBot: boolean;
    rateLimit: boolean;
    robotsTxt: boolean;
    authentication: boolean;
  }>;
}
```

**CheckResult:**

```typescript
interface CheckResult {
  readonly url: string;
  readonly reachable: boolean;
  readonly duration: number;
  readonly screenshotPath?: string;
  readonly consoleErrors?: readonly string[];
  readonly detections?: DetectionResults;
}
```

**DetectionResults:**

```typescript
interface DetectionResults {
  readonly rateLimit?: RateLimitInfo;
  readonly antiBot?: AntiBotDetection;
  readonly robotsTxt?: RobotsTxtInfo;
  readonly authentication?: AuthenticationInfo;
}
```

## Design Decisions

### DD1: Use Playwright for Browser Automation

**Decision:** Use Playwright with Chromium for all web interactions

**Rationale:**

- Playwright provides modern, reliable browser automation
- Chromium ensures consistent behavior across platforms
- Headless mode minimizes resource usage
- Better than puppeteer for VS Code integration

**Alternatives Considered:**

- Puppeteer: Less maintained, older API
- HTTP-only (axios/fetch): Cannot execute JavaScript
- Selenium: Heavier, slower, more complex

### DD2: Local-Only Operation

**Decision:** No remote telemetry or data collection

**Rationale:**

- Privacy-first approach
- Trust-building with users
- No infrastructure costs
- Simpler architecture

**Trade-offs:**

- No usage analytics for improvement
- No remote error reporting
- Users must report issues manually

### DD3: Configurable Detections

**Decision:** Allow users to enable/disable individual detection features

**Rationale:**

- Performance optimization (skip unneeded checks)
- Flexibility for different use cases
- Avoid overwhelming users with irrelevant data

**Implementation:**

- Each detection has boolean setting
- Disabled detections return undefined
- Results structure remains consistent

### DD4: Bun for Development

**Decision:** Use Bun instead of Node.js for development tasks

**Rationale:**

- Faster test execution
- Better performance for build tasks
- Compatible with existing tooling
- Modern JavaScript runtime

**Compatibility:**

- Extension still runs in VS Code's Node.js runtime
- Bun used only for development
- All dependencies compatible with both

### DD5: Frozen Configuration Objects

**Decision:** Return frozen (immutable) configuration objects

**Rationale:**

- Prevent accidental mutations
- Functional programming best practices
- Easier to reason about data flow
- Prevents subtle bugs

**Implementation:**

```typescript
return Object.freeze({
  timeout,
  viewport: Object.freeze({ width, height }),
  // ... other properties
});
```

## Implementation Details

### Browser Management

**Browser Lifecycle:**

1. Launch browser instance per check
2. Create isolated browser context
3. Create new page
4. Navigate to URL with timeout
5. Capture screenshot (if enabled)
6. Run detections
7. Close page, context, browser

**Resource Cleanup:**

```typescript
try {
  const browser = await playwright.chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  // ... perform check
} finally {
  await page?.close();
  await context?.close();
  await browser?.close();
}
```

### Detection Implementation

**Anti-Bot Detection Strategy:**

- Check HTTP response headers first (fast)
- Evaluate page JavaScript for global variables
- Scan DOM for detection-specific elements
- Combine signals for confidence

**Rate Limit Detection Strategy:**

- Parse all rate-limit-related headers
- Support multiple header formats
- Extract numeric values with validation
- Handle missing/malformed headers gracefully

**robots.txt Detection Strategy:**

- Fetch with 5-second timeout
- Parse line-by-line
- Extract directives by type
- Handle fetch failures gracefully

**Authentication Detection Strategy:**

- Check HTTP status code first
- Search for password input fields
- Scan for authentication keywords
- Combine signals for accuracy

### Error Handling

**Error Categories:**

1. User errors (invalid URL, bad input)
2. Network errors (unreachable, timeout)
3. Browser errors (launch failure, crash)
4. System errors (permission, disk space)

**Error Handling Strategy:**

- Catch all errors at command level
- Log to Output channel
- Show user-friendly notifications
- Provide actionable suggestions
- Never expose stack traces to users

### Performance Optimization

**Strategies:**

- Parallel detection execution where possible
- Early bailout on critical failures
- Efficient DOM queries
- Minimize page.evaluate() calls
- Cleanup resources immediately

## Testing Strategy

### Unit Tests

**Coverage:**

- All detector modules (antibot, ratelimit, robotstxt, authentication)
- Configuration management
- URL validation
- Error handling utilities

**Framework:** Vitest with istanbul coverage

**Target:** >80% coverage

### Integration Tests

**Scope:**

- Command execution workflows
- Browser integration
- Configuration loading
- Error handling

**Approach:** Mock Playwright browser for deterministic tests

### Manual Testing

**Test Cases:**

- Various site types (static, SPA, protected)
- Different network conditions
- Configuration variations
- Error scenarios

## Deployment

### Release Process

1. Update version in `package.json`
2. Update `CHANGELOG.md`
3. Run full test suite
4. Build extension (`bun run build`)
5. Package extension (`bun run package`)
6. Test packaged extension
7. Publish to VS Code Marketplace
8. Create GitHub release
9. Update documentation

### Version Numbering

**Format:** MAJOR.MINOR.PATCH

**Semantic Versioning:**

- MAJOR: Breaking changes
- MINOR: New features (backward compatible)
- PATCH: Bug fixes

## Future Enhancements

### Planned Features

1. **Batch URL Checking**

   - Check multiple URLs in sequence
   - Export results to CSV/JSON

2. **Custom Detection Rules**

   - User-defined anti-bot patterns
   - Custom header checks

3. **Proxy Support**

   - Configure HTTP/SOCKS proxies
   - Rotate IP addresses

4. **Performance Profiling**

   - Detailed timing breakdown
   - Network waterfall

5. **Historical Tracking**
   - Store check history
   - Track site changes over time

### Not Planned

- Actual web scraping (out of scope)
- JavaScript execution/manipulation
- Form filling/interaction
- Authentication bypass

## Constraints

### Technical Constraints

- VS Code API limitations
- Playwright browser capabilities
- Network access requirements
- File system permissions

### Resource Constraints

- Memory: 500MB maximum
- Disk: 200MB (extension + browser)
- Network: Required for functionality
- CPU: Moderate (browser rendering)

### Security Constraints

- No external data transmission
- Local file system access only
- Browser sandbox limitations
- No shell command execution

## Compliance

### Licenses

- Extension: MIT License
- Playwright: Apache 2.0
- Chromium: Multiple (BSD-style)

### Ethical Considerations

- Respect robots.txt by default
- Provide rate limiting detection
- Warn about anti-bot systems
- Educate about responsible scraping

---

**Project:** [Issues](https://github.com/nolindnaidoo/scrape-le/issues) • [Pull Requests](https://github.com/nolindnaidoo/scrape-le/pulls) • [Releases](https://github.com/nolindnaidoo/scrape-le/releases) • [MIT License](LICENSE)

**Dev:** [Spec](SPECIFICATION.md) • [Architecture](ARCHITECTURE.md) • [Development](DEVELOPMENT.md) • [Troubleshooting](TROUBLESHOOTING.md)

**Docs:** [Commands](COMMANDS.md) • [Notifications](NOTIFICATIONS.md) • [Status Bar](STATUSBAR.md) • [Config](CONFIGURATION.md) • [Performance](PERFORMANCE.md) • [Privacy](PRIVACY.md) • [Screenshots](SCREENSHOTS.md) • [Workflow](WORKFLOW.md)
