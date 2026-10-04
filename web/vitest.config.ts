import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

export default defineConfig((environment) =>
  mergeConfig(viteConfig(environment), {
    test: {
      pool: "threads",
      environment: "node",
      setupFiles: ["./tests/setup.ts"],
      projects: [
        {
          extends: true,
          test: {
            name: "shared",
            isolate: false,
            include: ["src/**/*.test.ts", "tests/**/*.test.js"],
            exclude: ["src/app/App.test.ts"],
          },
        },
        {
          extends: true,
          test: {
            name: "isolated",
            // App tests change DEV before importing the cached route configuration.
            include: ["src/app/App.test.ts"],
            isolate: true,
          },
        },
      ],
      environmentOptions: {
        jsdom: { url: "http://localhost/", pretendToBeVisual: true },
      },
      coverage: {
        provider: "v8",
        include: ["src/**/*.{ts,tsx}"],
        exclude: ["**/*.test.ts"],
        reporter: ["text", "html", "lcov"],
      },
    },
  }),
);
