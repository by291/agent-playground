import { configDefaults, defineConfig } from "vitest/config";

const INTEGRATION_TEST_TIMEOUT_MS = 60_000;
const INTEGRATION_HOOK_TIMEOUT_MS = 120_000;
// prettier-ignore
const coverageReporters = [
  "text",
  "html",
  "lcov",
] as const;

export default defineConfig({
  test: {
    environment: "node",
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.test.ts", "tests/**/*.test.js"],
          exclude: [...configDefaults.exclude, "**/*.integration.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["**/*.integration.test.ts"],
          globalSetup: ["./tests/postgres.ts"],
          testTimeout: INTEGRATION_TEST_TIMEOUT_MS,
          hookTimeout: INTEGRATION_HOOK_TIMEOUT_MS,
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["**/*.test.ts"],
      reporter: [...coverageReporters],
    },
  },
});
