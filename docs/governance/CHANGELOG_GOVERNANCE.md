# Changelog Governance

## Overview

This document defines the standards and guidelines for maintaining changelogs across all LE Family extensions. The goal is to create concise, scannable, and informative changelogs that provide value to users without overwhelming them.

## Core Principles

### 1. **User-Focused Content**

- Focus on user-visible changes and benefits
- Avoid technical implementation details
- Emphasize what users can do differently

### 2. **Scannable Format**

- Use clear, concise bullet points
- Group related changes logically
- Avoid walls of text

### 3. **Consistent Structure**

- Follow [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) format
- Use semantic versioning
- Maintain consistent section organization

## Changelog Structure

### Header

```markdown
# Changelog

All notable changes to [Extension-Name] will be documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
```

### Version Entry Format

```markdown
## [X.Y.Z] - YYYY-MM-DD

### Added

- Brief description of new features

### Changed

- Brief description of changes to existing features

### Fixed

- Brief description of bug fixes

### Removed

- Brief description of removed features (if any)
```

## Content Guidelines

### ✅ Good Changelog Entries

**User-Focused:**

- "Added support for 5 new file formats (XML, TOML, INI, Properties, YAML)"
- "Improved extraction speed by 40% for large files"
- "Added keyboard shortcut Ctrl+Alt+E for quick extraction"

**Concise:**

- "Fixed crash when processing empty files"
- "Added dark theme support for status bar"
- "Improved error messages for invalid configurations"

### ❌ Avoid These Patterns

**Too Technical:**

- "Implemented service factory pattern with dependency injection"
- "Added comprehensive validation system with security checks"
- "Enhanced TypeScript usage with strict mode compliance"

**Too Verbose:**

- Long paragraphs explaining implementation details
- Repetitive bullet points saying the same thing
- Excessive emoji usage and formatting

**Internal Metrics:**

- "Increased from 7 to 18 test files (157% improvement)"
- "61 TypeScript files - Highest in LE Family"
- "200 passing tests across 18 test suites"

## Writing Rules

### 1. **One Change Per Bullet**

```markdown
✅ Good:

- Added CSV streaming for large files
- Fixed memory leak in URL validation
- Improved error messages for invalid URLs

❌ Bad:

- Added CSV streaming, improved performance, and fixed memory leaks
```

### 2. **Use Present Tense**

```markdown
✅ Good:

- Added support for XML files
- Fixed crash on empty input
- Improved extraction speed

❌ Bad:

- Added support for XML files
- Fixed crash on empty input
- Improved extraction speed
```

### 3. **Focus on User Impact**

```markdown
✅ Good:

- Added 13 language translations
- Improved extraction speed by 40%
- Fixed crash when processing large files

❌ Bad:

- Implemented vscode-nls with MessageFormat.file
- Optimized regex patterns and caching
- Added null pointer checks
```

### 4. **Group Related Changes**

```markdown
✅ Good:

- **File Format Support**
  - Added XML file parsing
  - Added TOML configuration support
  - Added INI file format support

❌ Bad:

- Added XML file parsing
- Added TOML configuration support
- Added INI file format support
- Fixed XML parsing bug
- Improved TOML performance
```

## Version Categories

### Major (X.0.0)

- New features that change user workflow
- Breaking changes to existing functionality
- Major architectural changes affecting users

### Minor (0.X.0)

- New features that don't break existing functionality
- New file format support
- New commands or settings
- Performance improvements

### Patch (0.0.X)

- Bug fixes
- Documentation updates
- Minor UI improvements
- Internal refactoring with no user impact

## Examples

### ✅ Good Major Release

```markdown
## [2.0.0] - 2025-01-15

### Added

- **Multi-format support** - Added XML, TOML, INI, and Properties file formats
- **13 language translations** - Full localization for German, Spanish, French, and 10 other languages
- **CSV streaming** - Process large CSV files without memory issues

### Changed

- **Default behavior** - Results now open side-by-side by default
- **Performance** - Improved extraction speed by 40% for large files

### Fixed

- Fixed crash when processing empty files
- Fixed memory leak in URL validation
```

### ❌ Bad Major Release (Too Verbose)

```markdown
## [2.0.0] - 2025-01-15

### 🚀 Major Release - LE Family Parity Achievement

This release brings Extension-LE to full parity with other LE Family extensions, establishing it as a leading member of the suite with comprehensive features, enterprise-grade architecture, and extensive internationalization.

#### **🏗️ Architecture Upgrades**

- **Service Factory Pattern** - Implemented centralized service initialization with dependency injection for better testability and maintainability
- **Settings Schema Validation** - Added comprehensive validation system with security checks, prototype pollution prevention, and type safety
  [... continues for 50+ more lines]
```

## Maintenance Guidelines

### 1. **Regular Reviews**

- Review changelog before each release
- Remove redundant or overly technical entries
- Ensure consistency across all LE extensions

### 2. **User Testing**

- Ask non-technical users to review changelogs
- Ensure entries are understandable without context
- Focus on "what can I do now that I couldn't before?"

### 3. **Cross-Extension Consistency**

- Use similar language and structure across all LE extensions
- Maintain consistent categorization
- Align with LE Family branding and messaging

## Enforcement

### Pre-Release Checklist

- [ ] Changelog follows this governance document
- [ ] All entries are user-focused and concise
- [ ] No technical implementation details
- [ ] Consistent formatting and structure
- [ ] Reviewed by non-technical team member

### Quality Metrics

- **Readability**: Can a user understand the change in 5 seconds?
- **Actionability**: Does the user know what they can do differently?
- **Completeness**: Are all user-visible changes documented?
- **Conciseness**: Is the changelog under 50 lines for major releases?

---

**Remember**: Changelogs are for users, not developers. Focus on what users care about, not how we built it.
