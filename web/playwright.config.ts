import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e/regression",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: process.env.CI ? 1 : 2,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [
    ["list"],
    ["html", { open: "never" }],
    ["./tests/e2e/runtime-reporter.ts"],
  ],
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "production-chromium",
      testIgnore: ["**/activity.spec.ts", "**/gallery.spec.ts"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "development-chromium",
      testMatch: ["**/activity.spec.ts", "**/gallery.spec.ts"],
      use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:4174" },
    },
  ],
  webServer: [
    {
      name: "Backend",
      command:
        "pnpm --filter agent-playground-server exec tsx tests/e2e/server.ts",
      url: "http://127.0.0.1:4300/health",
      timeout: 120_000,
      reuseExistingServer: false,
      gracefulShutdown: { signal: "SIGTERM", timeout: 15_000 },
    },
    {
      name: "Production frontend",
      command:
        "pnpm exec vite build && pnpm exec vite preview --host 127.0.0.1 --port 4173 --strictPort",
      env: {
        BACKEND_URL: "http://127.0.0.1:4300",
        VITE_OBSERVABILITY_ENABLED: "false",
      },
      url: "http://127.0.0.1:4173",
      timeout: 60_000,
      reuseExistingServer: false,
      gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
    },
    {
      name: "Development frontend",
      command: "pnpm exec vite --host 127.0.0.1 --port 4174 --strictPort",
      env: {
        BACKEND_URL: "http://127.0.0.1:4300",
        VITE_OBSERVABILITY_ENABLED: "false",
      },
      url: "http://127.0.0.1:4174",
      timeout: 60_000,
      reuseExistingServer: false,
      gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
    },
  ],
});
