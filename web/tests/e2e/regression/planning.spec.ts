import { capture, expect, test } from "../fixtures";

test("agent plans update through the real adapter and recover from the archived tool transcript", async ({
  page,
  request,
}, testInfo) => {
  await page.goto("/");
  const composer = page.getByRole("textbox", { name: "Message" });
  const submitted = page.waitForRequest(
    (entry) =>
      entry.method() === "POST" && new URL(entry.url()).pathname === "/agent",
  );

  await composer.fill("Investigate a reliability regression.");
  await composer.press("Enter");
  const input = (await submitted).postDataJSON() as { threadId: string };
  const plan = page.getByRole("region", { name: "Agent plan", exact: true });

  await expect(plan).toBeVisible();
  await expect(plan).toContainText("0 of 2 completed");
  await expect(plan).toContainText("Compare failure rates");
  await expect(plan).toContainText("In progress");
  await capture(page, testInfo, "planning-running.png");
  const toolHistory = page.getByRole("button", {
    name: "Tool Update plan Completed",
    exact: true,
  });

  await toolHistory.focus();
  const released = await request.post(
    `http://127.0.0.1:4300/__e2e/release/${input.threadId}`,
  );

  expect(released.ok()).toBe(true);
  await expect(composer).toBeEnabled();
  await expect(plan).toContainText("3 of 3 completed");
  await expect(plan).toContainText("Check deployment changes");
  await expect(plan).toContainText("Summarize the evidence");
  await expect(
    page.getByLabel("Assistant reply", { exact: true }),
  ).toContainText("The deployment change explains the increased failure rate.");
  await expect(composer).not.toBeFocused();

  await page.reload();
  await expect(plan).toContainText("3 of 3 completed");
  await expect(plan).toContainText("Summarize the evidence");
  await capture(page, testInfo, "planning-restored.png");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(plan).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  await capture(page, testInfo, "planning-mobile.png");
});
