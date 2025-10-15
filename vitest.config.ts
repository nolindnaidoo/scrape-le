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
          branches: 70,
          functions: 75,
          lines: 75,
          statements: 75,
        },
      },
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.spec.ts",
        "src/__mocks__/**",
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
