import { expect, test } from "../fixtures";
import type { Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import {
  approveWorkflowReview,
  startWorkflowReview,
  verifyFreshWelcome,
  verifyToolReply,
} from "../flows";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("fresh and restored empty conversations show the welcome page", async ({
  page,
}) => {
  const externalAssets: string[] = [];

  page.on("request", (request) => {
    const isFontAsset = ["font", "stylesheet"].includes(request.resourceType());

    if (
      isFontAsset &&
      new URL(request.url()).origin !== new URL(page.url()).origin
    ) {
      externalAssets.push(request.url());
    }
  });
  await verifyFreshWelcome(page);
  expect(externalAssets).toEqual([]);
  const interLoaded = await page.evaluate(async () => {
    const fonts = await document.fonts.load("400 16px Inter");

    return fonts.some((font) => font.status === "loaded");
  });

  expect(interLoaded).toBe(true);
});

test("tool replies expose details and restore without duplicating the answer", async ({
  page,
}) => {
  await verifyToolReply(page);
});

test("a paused workflow restores its review and persists the edited approval", async ({
  page,
}) => {
  await startWorkflowReview(page);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Approve plan" }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message" })).toBeDisabled();
  await approveWorkflowReview(page);
  await expect(page.getByRole("region", { name: "Messages" })).toContainText(
    "Check recovery",
  );
});

async function startHeldReply(page: Page) {
  const submitted = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/agent",
  );

  await page
    .getByRole("textbox", { name: "Message" })
    .fill(`Stream a code sample. ${randomUUID()}`);
  await page.getByRole("textbox", { name: "Message" }).press("Enter");
  const input = (await submitted).postDataJSON() as { threadId: string };

  await expect(
    page.getByLabel("Assistant reply", { exact: true }),
  ).toContainText("Here is a C example.");
  await expect(page.getByRole("textbox", { name: "Message" })).toBeDisabled();

  return input.threadId;
}

test.describe("animated streaming", () => {
  test.use({ replyAnimation: true, reducedMotion: "no-preference" });

  test("partial text streams before completion and the highlighted code copies its source", async ({
    page,
    context,
    request,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const threadId = await startHeldReply(page);
    const released = await request.post(
      `http://127.0.0.1:4300/__e2e/release/${threadId}`,
    );

    expect(released.ok()).toBe(true);
    await expect(page.getByRole("textbox", { name: "Message" })).toBeEnabled();
    const reply = page.getByLabel("Assistant reply", { exact: true });

    await expect(reply.locator('[data-streamdown="code-block"]')).toBeVisible();
    await expect(reply.locator("code span[style]").first()).toBeVisible();
    await reply.getByTitle("Copy code").click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe("int main(void) {\n  return 0;\n}\n");
  });
});

test("reloading during a run recovers the completed reply without resubmitting", async ({
  page,
  request,
}) => {
  const threadId = await startHeldReply(page);
  let submissionsAfterReload = 0;

  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/agent"
    ) {
      submissionsAfterReload += 1;
    }
  });
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Message" })).toBeDisabled();
  const released = await request.post(
    `http://127.0.0.1:4300/__e2e/release/${threadId}`,
  );

  expect(released.ok()).toBe(true);
  await expect(
    page.getByLabel("Assistant reply", { exact: true }),
  ).toContainText("int main(void)");
  await expect(page.getByRole("textbox", { name: "Message" })).toBeEnabled();
  await expect(page.getByLabel("Assistant reply", { exact: true })).toHaveCount(
    1,
  );
  expect(submissionsAfterReload).toBe(0);
});
