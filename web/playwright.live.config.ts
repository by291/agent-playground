import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL;

if (!baseURL) {
  throw new Error(
    "Set E2E_BASE_URL to the running development frontend for live smoke tests.",
  );
}

export default defineConfig({
  testDir: "./tests/e2e/live",
  outputDir: "test-results/live",
  forbidOnly: Boolean(process.env.CI),
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 60_000 },
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report/live", open: "never" }],
  ],
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "live-chromium", use: { ...devices["Desktop Chrome"] } }],
});
