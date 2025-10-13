# Scrape-LE Development Guide

Guide for contributors and developers working on Scrape-LE.

## Prerequisites

- **Bun**: 1.0.0 or higher (replaces Node.js and npm)
- **VS Code**: 1.105.0 or higher
- **Git**: For version control

Verify installation:

```bash
bun --version   # v1.0.0+
code --version  # 1.105.0+
```

Install Bun if needed:

```bash
curl -fsSL https://bun.sh/install | bash
```

## Initial Setup

### 1. Clone Repository

```bash
git clone https://github.com/nolindnaidoo/scrape-le.git
cd scrape-le
```

### 2. Install Dependencies

```bash
bun install
```

### 3. Install Playwright Browser

```bash
bun run install:browser
# or directly: bunx playwright install chromium
```

### 4. Open in VS Code

```bash
code .
```

## Project Structure

```
scrape-le/
├── src/                    # Source code
│   ├── commands/           # VS Code command implementations
│   ├── config/             # Configuration management
│   ├── scraper/            # Browser automation core
│   ├── ui/                 # User interface components
│   ├── utils/              # Utility functions
│   ├── __mocks__/          # Test mocks
│   ├── extension.ts        # Extension entry point
│   └── types.ts            # TypeScript type definitions
├── docs/                   # Documentation
├── dist/                   # Compiled JavaScript (generated)
├── coverage/               # Test coverage reports (generated)
├── .vscode/                # VS Code configuration
│   ├── launch.json         # Debug configurations
│   ├── tasks.json          # Build tasks
│   ├── settings.json       # Workspace settings
│   └── extensions.json     # Recommended extensions
├── package.json            # Extension manifest and dependencies
├── tsconfig.json           # TypeScript configuration
├── vitest.config.ts        # Test configuration
├── biome.json              # Linter/formatter configuration
└── README.md               # User documentation
```

## Development Workflow

### Build Commands

```bash
# Build once
bun run build

# Watch mode (rebuilds on changes)
bun run watch

# Clean build artifacts
bun run clean
```

### Testing

```bash
# Run all tests
bun test

# Run tests in watch mode
bun run test:watch

# Generate coverage report
bun run test:coverage

# View coverage report
open coverage/index.html
```

### Linting and Formatting

```bash
# Check code style
bun run lint

# Auto-fix issues
bun run lint:fix
```

### Packaging

```bash
# Create .vsix package
bun run package

# View package contents
bun run package:ls
```

## Debugging

### Debug Extension

1. Press `F5` or Run → Start Debugging
2. Select "Run Extension" configuration
3. New "Extension Development Host" window opens
4. Test your changes in the new window

### Debug Tests

1. Open test file
2. Set breakpoints
3. Press `F5` and select "Extension Tests"
4. Debugger stops at breakpoints

### Debug Configurations

Located in `.vscode/launch.json`:

**Run Extension:**

- Launches Extension Development Host
- Automatically builds before launching
- Hot reload on file changes

**Extension Tests:**

- Runs tests with debugger attached
- Set breakpoints in test files
- Inspect test failures

### Output Channels

Check these for debugging:

- **Scrape-LE**: Extension output
- **Extension Host**: Extension errors
- **Tasks**: Build output
- **Terminal**: Command output

## Code Style

### TypeScript Standards

- **Strict mode enabled**: All type checks enforced
- **Explicit return types**: On all exported functions
- **Readonly types**: Use `Readonly<>` for interfaces
- **Object.freeze()**: Freeze all exported objects

Example:

```typescript
export function createConfig(): Readonly<Config> {
  return Object.freeze({
    timeout: 30000,
    viewport: Object.freeze({ width: 1280, height: 720 }),
  });
}
```

### Functional Programming

- Prefer pure functions over classes
- Use factory functions for object creation
- Immutable data structures
- Dependency injection via parameters

### File Organization

- One component per file
- Export frozen objects
- Group related functionality
- Clear separation of concerns

### Naming Conventions

- **Files**: camelCase (`errorHandling.ts`)
- **Functions**: camelCase (`isValidUrl`)
- **Types**: PascalCase (`CheckResult`)
- **Constants**: UPPER_SNAKE_CASE (`DEFAULT_TIMEOUT`)
- **Private**: Prefix with `_` (`_installCheckPerformed`)

## Testing Guidelines

### Test Structure

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";

describe("Component Name", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("functionName", () => {
    it("should do something specific", () => {
      // Arrange
      const input = "test";

      // Act
      const result = processInput(input);

      // Assert
      expect(result).toBe("expected");
    });
  });
});
```

### Mocking

**VS Code API:**

```typescript
vi.mock("vscode", () => ({
  window: {
    showInformationMessage: vi.fn(),
  },
}));
```

**Playwright:**

```typescript
vi.mock("playwright-core", () => ({
  chromium: {
    launch: vi.fn().mockResolvedValue(mockBrowser),
  },
}));
```

### Coverage Goals

- Overall: >80%
- Utils: 100% (pure functions)
- Scraper: >75%
- Config: >60%

Run `bun run test:coverage` to check.

## Contributing

### Branch Strategy

- `main`: Production-ready code
- `develop`: Integration branch
- `feature/*`: New features
- `fix/*`: Bug fixes
- `docs/*`: Documentation updates

### Commit Messages

Follow conventional commits:

```
feat: add support for custom viewport sizes
fix: resolve timeout error on slow connections
docs: update configuration guide
test: add tests for URL validation
chore: update dependencies
```

### Pull Request Process

1. **Fork** the repository
2. **Create branch** from `develop`

```bash
git checkout -b feature/my-feature develop
```

3. **Make changes** with tests
4. **Run checks**

```bash
bun run lint
bun test
bun run build
```

5. **Commit** with clear messages
6. **Push** to your fork

```bash
git push origin feature/my-feature
```

7. **Create PR** to `develop` branch
8. **Address review** feedback

### PR Checklist

- [ ] Tests added/updated
- [ ] All tests passing
- [ ] Linter checks passing
- [ ] Documentation updated
- [ ] CHANGELOG.md updated
- [ ] No breaking changes (or documented)

## Release Process

### Version Numbering

Follow [Semantic Versioning](https://semver.org/):

- **Major** (1.0.0): Breaking changes
- **Minor** (0.1.0): New features (backward compatible)
- **Patch** (0.0.1): Bug fixes

### Release Steps

1. **Update version** in `package.json`

```json
{
  "version": "0.2.0"
}
```

2. **Update CHANGELOG.md**

```markdown
## [0.2.0] - 2025-10-15

### Added

- New feature X

### Fixed

- Bug Y

[0.2.0]: https://github.com/nolindnaidoo/scrape-le/releases/tag/v0.2.0
```

3. **Run full build**

```bash
bun run clean
bun install
bun run lint
bun test
bun run build
bun run package
```

4. **Test .vsix locally**

```bash
code --install-extension release/scrape-le-0.2.0.vsix
```

5. **Create Git tag**

```bash
git tag -a v0.2.0 -m "Release v0.2.0"
git push origin v0.2.0
```

6. **Publish** (when ready)

```bash
bun run publish
```

## Architecture Decisions

### Why Playwright-Core?

- Lightweight (no bundled browsers)
- User controls browser installation
- Production-grade browser automation
- Good TypeScript support

### Why Functional Programming?

- Easier to test (pure functions)
- Immutable state reduces bugs
- Clear data flow
- Better composability

### Why Vitest with Bun?

- Bun provides ultra-fast JavaScript runtime
- Vitest for mature test framework with great VS Code integration
- Best of both worlds: Bun's speed + Vitest's features
- Seamless TypeScript support

### Why Biome?

- Fast linting and formatting
- Single tool replaces ESLint + Prettier
- Modern TypeScript support
- VS Code extension available

## Common Development Tasks

### Adding a New Command

1. Create command file:

```typescript
// src/commands/myCommand.ts
export function registerMyCommand(
  context: vscode.ExtensionContext,
  deps: Readonly<{ notifier: Notifier }>
): void {
  const command = vscode.commands.registerCommand(
    "scrape-le.myCommand",
    async () => {
      // Command logic
    }
  );

  context.subscriptions.push(command);
}
```

2. Register in `src/commands/index.ts`:

```typescript
import { registerMyCommand } from "./myCommand";

export function registerCommands(context, deps) {
  registerMyCommand(context, deps);
  // ... other commands
}
```

3. Add to `package.json`:

```json
{
  "contributes": {
    "commands": [
      {
        "command": "scrape-le.myCommand",
        "title": "My Command",
        "category": "Scrape-LE"
      }
    ]
  }
}
```

4. Add tests:

```typescript
// src/commands/myCommand.test.ts
describe("myCommand", () => {
  it("should do something", () => {
    // Test implementation
  });
});
```

### Adding a Configuration Option

1. Add to `package.json`:

```json
{
  "configuration": {
    "properties": {
      "scrape-le.myOption": {
        "type": "boolean",
        "default": true,
        "description": "My option description"
      }
    }
  }
}
```

2. Add to type definition:

```typescript
// src/types.ts
export type Config = Readonly<{
  myOption: boolean;
  // ... other options
}>;
```

3. Add to config reader:

```typescript
// src/config/config.ts
export function getConfiguration(): Config {
  const config = vscode.workspace.getConfiguration("scrape-le");

  return Object.freeze({
    myOption: config.get<boolean>("myOption") ?? true,
    // ... other options
  });
}
```

4. Add tests:

```typescript
// src/config/config.test.ts
it("should read myOption", () => {
  // Test implementation
});
```

## Troubleshooting Development

### Build Errors

**TypeScript errors:**

```bash
# Clean and rebuild
bun run clean
bun run build
```

**Dependency issues:**

```bash
# Clean install
rm -rf node_modules bun.lock
bun install
```

### Test Failures

**Mock not working:**

```typescript
// Ensure mocks are cleared
beforeEach(() => {
  vi.clearAllMocks();
});
```

**Async timing:**

```typescript
// Use proper async/await
it("should work", async () => {
  await someAsyncFunction();
  expect(result).toBe(expected);
});
```

### Debugging Tips

- Use `console.log` in Extension Development Host
- Check "Extension Host" output channel
- Set breakpoints in `.ts` files (they work!)
- Use VS Code debugger (F5)

---

**Related Documentation:**

- [Architecture Guide](ARCHITECTURE.md)
- [Testing Guide](TESTING.md)
- [Configuration Guide](CONFIGURATION.md)
- [Troubleshooting Guide](TROUBLESHOOTING.md)

**External Resources:**

- [VS Code Extension API](https://code.visualstudio.com/api)
- [Playwright Documentation](https://playwright.dev/)
- [Vitest Documentation](https://vitest.dev/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)


---
**Project:** [Issues](https://github.com/nolindnaidoo/scrape-le/issues) • [Pull Requests](https://github.com/nolindnaidoo/scrape-le/pulls) • [Releases](https://github.com/nolindnaidoo/scrape-le/releases) • [MIT License](LICENSE)

**Dev:** [Spec](SPECIFICATION.md) • [Architecture](ARCHITECTURE.md) • [Development](DEVELOPMENT.md) • [Troubleshooting](TROUBLESHOOTING.md)

**Docs:** [Commands](COMMANDS.md) • [Notifications](NOTIFICATIONS.md) • [Status Bar](STATUSBAR.md) • [Config](CONFIGURATION.md) • [Performance](PERFORMANCE.md) • [Privacy](PRIVACY.md) • [Screenshots](SCREENSHOTS.md) • [Workflow](WORKFLOW.md)
