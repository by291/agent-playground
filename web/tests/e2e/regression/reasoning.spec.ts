import { expect, test } from "@playwright/test";

test("reasoning streams before the answer, folds for text and survives checkpoint recovery and reload", async ({
  page,
  request,
}, testInfo) => {
  await page.goto("/");
  const composer = page.getByRole("textbox", { name: "Message" });
  const submitted = page.waitForRequest(
    (entry) =>
      entry.method() === "POST" && new URL(entry.url()).pathname === "/agent",
  );

  await composer.fill("Compare approaches with reasoning.");
  await composer.press("Enter");
  const input = (await submitted).postDataJSON() as { threadId: string };
  const reply = page.getByLabel("Assistant reply", { exact: true });
  const reasoning = "First, compare the constraints. Then check the tradeoffs.";

  await expect(
    reply.getByRole("button", { name: "Thinking", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(reply).toContainText(reasoning);
  await expect(reply).not.toContainText("Approach A is simpler.");
  await page.screenshot({
    path: testInfo.outputPath("reasoning-streaming.png"),
  });
  const reasoningReleased = await request.post(
    `http://127.0.0.1:4300/__e2e/release/${input.threadId}`,
  );

  expect(reasoningReleased.ok()).toBe(true);
  const toggle = reply.getByRole("button", { name: "Reasoning", exact: true });

  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(reply).toContainText("Approach A is simpler.");
  await expect(reply).not.toContainText(reasoning);
  await toggle.click();
  await expect(reply).toContainText(reasoning);
  const answerReleased = await request.post(
    `http://127.0.0.1:4300/__e2e/release/${input.threadId}`,
  );

  expect(answerReleased.ok()).toBe(true);
  await expect(composer).toBeEnabled();
  await expect(reply).toContainText("Approach B is more flexible.");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(toggle).toBeFocused();
  await expect(reply).toHaveCount(1);
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(reply).toContainText(reasoning);
  await expect(reply).toContainText("Approach B is more flexible.");
  await page.screenshot({
    path: testInfo.outputPath("reasoning-restored.png"),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(toggle).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
});
