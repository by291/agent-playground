import { test as base, type Page, type TestInfo } from "@playwright/test";

export { expect } from "@playwright/test";

export const test = base.extend<{ replyAnimation: boolean }>({
  replyAnimation: [false, { option: true }],
  reducedMotion: "reduce",
  storageState: async ({ baseURL, replyAnimation }, provide) => {
    if (!baseURL) {
      throw new Error("Browser tests require a base URL.");
    }

    await provide({
      cookies: [],
      origins: [
        {
          origin: new URL(baseURL).origin,
          localStorage: [
            {
              name: "agent-playground-preferences",
              value: JSON.stringify({ replyAnimation }),
            },
          ],
        },
      ],
    });
  },
});

export async function capture(page: Page, info: TestInfo, name: string) {
  if (process.env.E2E_CAPTURE === "1") {
    await page.screenshot({
      path: info.outputPath(name),
      animations: "disabled",
    });
  }
}
