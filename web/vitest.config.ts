import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

export default defineConfig((environment) =>
  mergeConfig(viteConfig(environment), {
    test: {
      pool: "threads",
      environment: "node",
      include: ["src/**/*.test.ts", "tests/**/*.test.js"],
      setupFiles: ["./tests/setup.ts"],
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
