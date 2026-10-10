import { capture, expect, test } from "../fixtures";
import type { Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import {
  approveWorkflowReview,
  startWorkflowReview,
  verifyFreshWelcome,
  verifyToolReply,
  timePrompt,
} from "../flows";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("fresh and restored empty conversations show the welcome page", async ({
  page,
}) => {
  const externalAssets: string[] = [];
  const threadRequests: string[] = [];

  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    const isFontAsset = ["font", "stylesheet"].includes(request.resourceType());

    if (path === "/agent" || /^\/conversations\/[^/]+(?:\/|$)/.test(path)) {
      threadRequests.push(path);
    }

    if (
      isFontAsset &&
      new URL(request.url()).origin !== new URL(page.url()).origin
    ) {
      externalAssets.push(request.url());
    }
  });
  await verifyFreshWelcome(page);
  await page
    .getByRole("button", { name: "New conversation", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Message" })
    .fill("A draft I have not sent");
  expect(new URL(page.url()).pathname).toBe("/");
  expect(
    await page.evaluate(() =>
      localStorage.getItem("agent-playground-conversation"),
    ),
  ).toBeNull();
  expect(threadRequests).toEqual([]);
  expect(externalAssets).toEqual([]);
  const interLoaded = await page.evaluate(async () => {
    const fonts = await document.fonts.load("400 16px Inter");

    return fonts.some((font) => font.status === "loaded");
  });

  expect(interLoaded).toBe(true);
});

test("tool replies expose details and restore without duplicating the answer", async ({
  page,
}, testInfo) => {
  const submissions: { threadId: string }[] = [];

  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/agent"
    ) {
      submissions.push(request.postDataJSON() as { threadId: string });
    }
  });
  await verifyToolReply(page);
  expect(submissions).toHaveLength(1);
  const threadId = submissions[0]!.threadId;

  await expect(page).toHaveURL(new RegExp(`/c/${threadId}$`));
  await capture(page, testInfo, "tool-process-desktop.png");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  await capture(page, testInfo, "tool-process-mobile.png");
  await page.getByRole("textbox", { name: "Message" }).fill(timePrompt);
  await page.getByRole("textbox", { name: "Message" }).press("Enter");
  await expect(page.getByLabel("Assistant reply", { exact: true })).toHaveCount(
    2,
  );
  await expect(page.getByRole("textbox", { name: "Message" })).toBeEnabled();
  expect(submissions).toHaveLength(2);
  expect(submissions[1]!.threadId).toBe(threadId);
});

test("nested memory tools complete during streaming without flashing failure", async ({
  page,
  request,
}) => {
  const submitted = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/agent",
  );

  await page
    .getByRole("textbox", { name: "Message" })
    .fill("Remember a durable preference.");
  await page.getByRole("textbox", { name: "Message" }).press("Enter");
  const input = (await submitted).postDataJSON() as { threadId: string };
  const tools = page.getByRole("button", {
    name: /Tool.*remember_memory.*Completed/,
  });

  await expect(tools).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message" })).toBeDisabled();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(
    page.getByLabel("Assistant reply", { exact: true }),
  ).not.toContainText("Preference saved.");
  const released = await request.post(
    `http://127.0.0.1:4300/__e2e/release/${input.threadId}`,
  );

  expect(released.ok()).toBe(true);
  await expect(
    page.getByLabel("Assistant reply", { exact: true }),
  ).toContainText("Preference saved.");
  await expect(page.getByRole("textbox", { name: "Message" })).toBeEnabled();
  await page.reload();
  await expect(tools).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
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

    // Native Windows clipboard reads normalize line feeds to CRLF.
    await expect
      .poll(async () =>
        (await page.evaluate(() => navigator.clipboard.readText())).replace(
          /\r\n/g,
          "\n",
        ),
      )
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
