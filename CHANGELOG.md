# Changelog

All notable changes to the "Scrape-LE" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.6] - 2025-10-16

### Technical

- **Code quality maintenance** - Ran lint:fix to ensure code quality standards
- **Package generation** - Created fresh extension package (scrape-le-1.4.6.vsix)
- **Build verification** - Verified all build processes and dependencies are working correctly

## [1.4.5] - 2025-10-15

### Changed

- **Documentation streamlined** - Reduced from 13 to 4 core docs (Architecture, Commands, I18N, Performance) for easier maintenance
- **Performance transparency** - Added verified benchmarks (simple pages < 2s, heavy JS 5-10s) with detection accuracy metrics
- **Language visibility** - Enhanced README to clearly show all 13 supported languages with flags and native names
- **Governance compliance** - Implemented FALSE_CLAIMS_GOVERNANCE and CHANGELOG_GOVERNANCE for accuracy and consistency

## [1.1.2] - 2025-10-13

### Changed

- **Documentation update** - Updated README to reflect comprehensive multi-language support with 13 languages
- **User experience** - Enhanced README language support section with flag emojis and native descriptions

### Technical

- Updated README to accurately document existing multi-language capabilities
- Maintained 100% backward compatibility with existing installations

## [1.1.1] - 2025-10-13

### Fixed

- **Help command activation** - Added missing `"onCommand:scrape-le.help"` activation event to ensure help command works properly
- **Command palette completeness** - Added missing `scrape-le.help` command to command palette
- **Command parity** - Fixed inconsistency where help command was defined but not properly activated or accessible

### Technical

- All 6 commands now have proper activation events and command palette entries for consistent functionality
- Maintained 100% backward compatibility with existing installations

## [1.1.0] - 2025-10-14

### Added

- **Command parity achievement** - Full parity with other LE extraction extensions
- **Help command** - Added comprehensive help and troubleshooting documentation accessible from command palette
- **Comprehensive documentation** - Added complete command list to README with examples
- **Documentation updates** - Updated all docs to reflect command parity achievement

### Changed

- **Help command UX** - Help documentation now opens beside source code by default for better workflow
- **Infrastructure verification** - Verified activation events, command registry, and all infrastructure components
- **Command count** - Stabilized at 6 commands (Check URL, Scrape Text, Scrape HTML, Screenshot, Settings, Help)

## [1.0.2] - 2025-10-14

### Fixed

- **VSCode engine version requirement** - Changed from `^1.105.0` to `^1.70.0` for better compatibility with current VSCode versions

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
