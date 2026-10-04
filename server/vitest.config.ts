import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["**/*.test.ts"],
          exclude: [...configDefaults.exclude, "**/*.integration.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["**/*.integration.test.ts"],
          testTimeout: 60_000,
          hookTimeout: 120_000,
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: [
        "agent/**/*.ts",
        "http/**/*.ts",
        "conversation/**/*.ts",
        "db/**/*.ts",
        "observability/**/*.ts",
        "app.ts",
        "config.ts",
      ],
      exclude: ["**/*.test.ts"],
      reporter: ["text", "html", "lcov"],
    },
  },
});
