# Changelog

All notable changes to the "Scrape-LE" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.1] - 2025-10-14

### Documentation

- Fixed test coverage from outdated 84.84% to current 82.17% overall coverage
- Updated test count from 75 to 121 passing tests (1 skipped)
- Ensures documentation matches current test results

## [1.0.0] - 2025-10-13

### Added

- Initial release of Scrape-LE
- Check URL scrapeability with real browser (Chromium via Playwright)
- Full-page screenshot capture with configurable viewports
- Console error and warning detection
- Advanced detection features:
  - Anti-bot detection (Cloudflare, reCAPTCHA, hCaptcha, DataDome, Perimeter81)
  - Rate limiting detection (standard HTTP headers)
  - robots.txt compliance checking
  - Authentication wall detection (login forms, 401/403 status)
- Status bar integration with real-time feedback
- Command palette integration
- Check selected text as URL
- Browser setup wizard
- Configurable settings for all features
- Output channel with detailed results
- Comprehensive test coverage (75 tests, 84.84% coverage)
- Full documentation suite

### Features

- **Zero Hassle Checking**: One-click URL scrapeability verification
- **Real Browser**: Uses Chromium for authentic page rendering
- **Visual Confirmation**: Full-page screenshots of rendered pages
- **Smart Detection**: Multiple detection systems for common scraping obstacles
- **Configurable Timeouts**: 5-120 second timeout range
- **Multiple Viewports**: Support from mobile (320px) to 4K (3840px)
- **Keyboard Shortcuts**: Quick access via Ctrl+Alt+S / Cmd+Alt+S
- **Notifications**: Configurable notification levels (all, important, silent)
- **Privacy First**: Local-only operation, no telemetry

### Technical

- Built with Bun for fast development workflow
- TypeScript with strict mode enabled
- Vitest + Istanbul for testing and coverage
- Biome for linting and formatting
- Playwright-core for browser automation
- Comprehensive error handling
- Functional programming patterns
- Immutable configuration objects
- Zero external data transmission

### Documentation

- Complete README with usage examples
- Architecture documentation
- Command reference guide
- Configuration guide
- Performance benchmarks
- Privacy & security guide
- Testing guide
- Troubleshooting guide
- Notification system guide
- Status bar integration guide
- Screenshot documentation guide
- Technical specification
- Workflow patterns & best practices

[1.0.0]: https://github.com/nolindnaidoo/scrape-le/releases/tag/v1.0.0
