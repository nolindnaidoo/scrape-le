import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    pool: "threads",
    coverage: {
      provider: "istanbul",
      reporter: ["text", "json", "html", "lcov"],
      threshold: {
        global: {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80,
        },
      },
      include: [
        "src/config/**/*.ts",
        "src/scraper/**/*.ts",
        "src/detectors/**/*.ts",
        "src/utils/**/*.ts",
      ],
      exclude: [
        "src/**/*.test.ts",
        "src/__mocks__/**",
        "src/types.ts",
        "src/extension.ts",
        "src/ui/**",
        "src/commands/**",
        "src/**/__data__/**",
        "**/node_modules/**",
        "**/dist/**",
        "**/coverage/**",
        "**/release/**",
        "**/docs/**",
        "**/*.config.*",
        "**/test/**",
      ],
    },
    include: ["src/**/*.test.ts"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "**/release/**",
      "**/docs/**",
      "**/__mocks__/**",
      "**/test/**",
    ],
  },
  resolve: {
    alias: {
      vscode: path.resolve(__dirname, "src/__mocks__/vscode.ts"),
    },
  },
});
