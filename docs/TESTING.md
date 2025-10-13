# Scrape-LE Testing

Comprehensive testing strategy ensuring reliability, performance, and production-grade quality.

## Testing Philosophy

- **Unit tests** validate pure functions in isolation
- **Integration tests** verify command flows with mocked dependencies
- **High coverage** maintained with fast feedback (81%+ coverage)
- **Mock external dependencies** for fast, reliable tests
- **Edge case focused** to catch real-world issues

## Test Organization

```
src/
├── commands/
│   ├── checkSelection.test.ts    # Selection command tests
│   └── setup.test.ts             # Setup command tests
├── config/
│   ├── config.test.ts            # Configuration validation
│   └── settings.test.ts          # Settings command tests
├── scraper/
│   ├── browser.test.ts           # Browser lifecycle tests
│   ├── checker.test.ts           # Page check logic tests
│   ├── install.test.ts           # Installation helper tests
│   └── __data__/
│       └── mock-page.ts          # Playwright page mocks
├── utils/
│   ├── errorHandling.test.ts    # Error utilities tests
│   └── url.test.ts               # URL processing tests
└── __mocks__/
    └── vscode.ts                 # VS Code API mocks
```

## Running Tests

```bash
# Full test suite
bun test

# Coverage report (text + HTML)
bun run test:coverage
# Output: coverage/index.html

# Watch mode for development
bun run test:watch

# Linting
bun run lint
bun run lint:fix
```

## Test Structure

### Unit Tests (Pure Functions)

```typescript
import { describe, it, expect } from "vitest";
import { isValidUrl } from "../utils/url";

describe("isValidUrl", () => {
  it("should validate correct URLs", () => {
    expect(isValidUrl("https://example.com")).toBe(true);
    expect(isValidUrl("http://localhost:3000")).toBe(true);
  });

  it("should reject invalid URLs", () => {
    expect(isValidUrl("not a url")).toBe(false);
    expect(isValidUrl("")).toBe(false);
  });
});
```

### Integration Tests (Commands)

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

vi.mock("vscode", () => ({
  window: {
    showInputBox: vi.fn(),
    withProgress: vi.fn(),
  },
  commands: {
    registerCommand: vi.fn((_, callback) => ({ dispose: vi.fn() })),
  },
}));

describe("checkUrlCommand", () => {
  it("should validate URL before checking", async () => {
    // Test implementation
  });
});
```

### Mocking Playwright

```typescript
vi.mock("playwright-core", () => ({
  chromium: {
    launch: vi.fn().mockResolvedValue({
      newPage: vi.fn(),
      close: vi.fn(),
    }),
  },
}));
```

## Test Categories

### Core Logic Tests

- **Browser management**: Launch, close, availability detection
- **Page checking**: Navigation, data extraction, error handling
- **URL processing**: Validation, normalization, extraction
- **Config management**: Settings reading, validation, defaults

### Error Path Tests

- **Network failures**: Timeout, DNS errors, connection refused
- **Invalid input**: Malformed URLs, empty strings, null values
- **Browser issues**: Launch failures, page errors, screenshot failures
- **Installation**: Browser not found, install failures

### Edge Case Tests

- **Boundary conditions**: Very long URLs, special characters
- **Async timing**: Console errors during navigation
- **Resource cleanup**: Browser closure on errors
- **User cancellation**: Input cancellation, quick pick dismissal

## Coverage Requirements

### Current Status

```
Overall Coverage:    81.37%
Statements:          81.37%
Branches:            93.5%
Functions:           90.9%
```

### Minimum Thresholds

- **Overall**: >80% line coverage ✅
- **Utils**: 100% (pure functions) ✅
- **Scraper**: >75% (browser logic) ✅
- **Config**: >60% (settings management) ✅

### Coverage Exclusions

- Type definitions (`src/types.ts`)
- Test files (`*.test.ts`)
- Mock files (`src/__mocks__/`)
- UI thin wrappers (`src/ui/**`)
- Command wrappers (`src/commands/**`)
- Test fixtures (`src/**/__data__/**`)

### Coverage Reporting

```bash
bun run test:coverage
```

Output formats:

- **Text report**: Console summary with percentages
- **HTML report**: `coverage/index.html` for detailed analysis
- **LCOV report**: `coverage/lcov.info` for CI integration
- **JSON report**: `coverage/coverage-final.json`

## Mock Strategies

### VS Code API Mocking

Located in `src/__mocks__/vscode.ts`:

```typescript
export const window = {
  showInputBox: vi.fn(),
  showInformationMessage: vi.fn(),
  showWarningMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  withProgress: vi.fn(),
  activeTextEditor: undefined,
};

export const workspace = {
  getConfiguration: vi.fn(() => ({
    get: vi.fn(),
  })),
  workspaceFolders: [],
};
```

### Playwright Mocking

Create mock browser and page objects:

```typescript
const mockPage = {
  goto: vi.fn().mockResolvedValue({ status: () => 200 }),
  title: vi.fn().mockResolvedValue("Test Page"),
  screenshot: vi.fn().mockResolvedValue(Buffer.from("test")),
  close: vi.fn().mockResolvedValue(undefined),
  on: vi.fn(),
};

const mockBrowser = {
  newPage: vi.fn().mockResolvedValue(mockPage),
  close: vi.fn().mockResolvedValue(undefined),
};
```

## Debugging Tests

### Running Single Test

```bash
bun test src/scraper/browser.test.ts
```

### Using `.only`

```typescript
it.only("should test this specific case", () => {
  // This test will run alone
});
```

### VS Code Test Debugger

1. Open test file
2. Set breakpoints
3. Press F5 → Select "Extension Tests"
4. Debugger stops at breakpoints

### Common Issues

**Mock not working**

- Check `vi.clearAllMocks()` in `beforeEach`
- Verify mock is defined before import

**Async timing issues**

- Use proper `async/await` patterns
- Use `vi.waitFor()` for async conditions

**File not found**

- Use absolute paths or `__dirname`
- Check mock file paths in vitest.config.ts

## Best Practices

### Test Organization

```typescript
describe("Component Name", () => {
  describe("method name", () => {
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

### Test Naming

Use descriptive names that explain behavior:

✅ **Good**: `should return normalized URL with https protocol`
❌ **Bad**: `test normalizeUrl`

### Test Independence

Each test should:

- Set up its own data
- Not depend on other tests
- Clean up after itself (via `beforeEach`/`afterEach`)

### Assertion Quality

```typescript
// ✅ Good: Specific assertions
expect(result.url).toBe("https://example.com");
expect(result.statusCode).toBe(200);

// ❌ Bad: Vague assertions
expect(result).toBeTruthy();
expect(result.url).toBeDefined();
```

## Performance Testing

### Test Suite Speed

Target: <1s for full suite

```bash
npm test
# Duration: 339ms ✅
```

### Individual Test Speed

Keep tests fast:

- Mock slow operations (file I/O, network)
- Use synchronous code where possible
- Avoid unnecessary `setTimeout`

## CI Integration

### GitHub Actions Example

```yaml
- name: Run Tests
  run: bun test

- name: Generate Coverage
  run: bun run test:coverage

- name: Check Coverage Threshold
  run: |
    coverage=$(grep -oP 'All files\s+\|\s+\K[\d.]+' coverage/coverage-summary.json)
    if (( $(echo "$coverage < 80" | bc -l) )); then
      echo "Coverage $coverage% is below 80%"
      exit 1
    fi
```

## Maintenance

### When to Update Tests

- After adding new features
- When fixing bugs (add regression tests)
- When refactoring code
- Before each release

### Coverage Goals

Maintain >80% coverage:

- Add tests for new code immediately
- Review coverage reports regularly
- Focus on critical paths first

---

**Related Documentation:**

- [Architecture Guide](ARCHITECTURE.md)
- [Development Guide](DEVELOPMENT.md)
- [Contributing Guide](../README.md#contributing)


---
**Project:** [Issues](https://github.com/nolindnaidoo/scrape-le/issues) • [Pull Requests](https://github.com/nolindnaidoo/scrape-le/pulls) • [Releases](https://github.com/nolindnaidoo/scrape-le/releases) • [MIT License](LICENSE)

**Dev:** [Spec](SPECIFICATION.md) • [Architecture](ARCHITECTURE.md) • [Development](DEVELOPMENT.md) • [Troubleshooting](TROUBLESHOOTING.md)

**Docs:** [Commands](COMMANDS.md) • [Notifications](NOTIFICATIONS.md) • [Status Bar](STATUSBAR.md) • [Config](CONFIGURATION.md) • [Performance](PERFORMANCE.md) • [Privacy](PRIVACY.md) • [Screenshots](SCREENSHOTS.md) • [Workflow](WORKFLOW.md)
