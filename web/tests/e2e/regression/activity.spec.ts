import { expect, test } from "@playwright/test";
import { timePrompt } from "../flows";

test("activity width supports dragging and keyboard bounds and persists without changing the draft", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  const composer = page.getByRole("textbox", { name: "Message" });

  await composer.fill("Keep this draft while resizing activity");
  await page.getByRole("button", { name: "Show run activity" }).click();
  const panel = page.getByRole("complementary", { name: "Run activity" });
  const separator = page.getByRole("separator", { name: "Activity width" });

  await expect(separator).toHaveAttribute("aria-valuenow", "520");
  await expect.poll(async () => (await panel.boundingBox())!.width).toBe(520);
  await separator.press("ArrowLeft");
  await expect(separator).toHaveAttribute("aria-valuenow", "536");
  const handle = await separator.boundingBox();

  await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + 100);
  await page.mouse.down();
  await expect
    .poll(() => page.evaluate(() => document.body.style.cursor))
    .toBe("col-resize");
  await page.mouse.move(handle!.x + handle!.width / 2 - 48, handle!.y + 100, {
    steps: 6,
  });
  await page.mouse.up();
  await expect(separator).toHaveAttribute("aria-valuenow", "584");
  await expect.poll(async () => (await panel.boundingBox())!.width).toBe(584);
  expect(await page.evaluate(() => document.body.style.cursor)).toBe("");
  expect(await page.evaluate(() => document.body.style.userSelect)).toBe("");
  await page.getByRole("button", { name: "Close run activity" }).click();
  await expect(composer).toHaveValue("Keep this draft while resizing activity");
  await page.getByRole("button", { name: "Show run activity" }).click();
  await expect(separator).toHaveAttribute("aria-valuenow", "584");
  await page.reload();
  await page.getByRole("button", { name: "Show run activity" }).click();
  await expect(separator).toHaveAttribute("aria-valuenow", "584");
  await expect(
    page.getByRole("separator", { name: "Sidebar width" }),
  ).toHaveAttribute("aria-valuenow", "320");
  await separator.press("Home");
  await separator.press("ArrowRight");
  await expect(separator).toHaveAttribute("aria-valuenow", "400");
  await separator.press("End");
  await separator.press("ArrowLeft");
  await expect(separator).toHaveAttribute("aria-valuenow", "720");
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(separator).toBeHidden();
  await expect(composer).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(separator).toBeHidden();
  expect((await panel.boundingBox())!.width).toBeCloseTo(390, 3);
  expect(
    await page.evaluate(() =>
      localStorage.getItem("agent-playground-activity-width"),
    ),
  ).toBe("720");
});

test("activity shows every event with categories and highlighted payloads and copies the retained log", async ({
  page,
  context,
}, testInfo) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  const submitted = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/agent",
  );
  const composer = page.getByRole("textbox", { name: "Message" });

  await composer.fill(timePrompt);
  await composer.press("Enter");
  const input = (await submitted).postDataJSON() as {
    runId: string;
    threadId: string;
  };

  await expect(
    page.getByLabel("Assistant reply", { exact: true }),
  ).toContainText("UTC");
  await expect(composer).toBeEnabled();
  await page.getByRole("button", { name: "Show run activity" }).click();
  const panel = page.getByRole("complementary", { name: "Run activity" });

  await expect(
    panel.getByText("get_current_time", { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByText("TEXT_MESSAGE_CONTENT", { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole("checkbox", { name: "Merge stream content" }),
  ).toBeChecked();
  await panel.getByRole("checkbox", { name: "Merge stream content" }).uncheck();
  const start = panel
    .locator("details")
    .filter({ has: page.getByText("RUN_STARTED", { exact: true }) });

  await start.locator("summary").click();
  await expect(start.getByLabel("Event payload")).toContainText(input.runId);
  await expect(start.getByLabel("Event payload")).toContainText(input.threadId);
  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, "writeText", {
      configurable: true,
      value: () =>
        Promise.reject(new DOMException("Clipboard denied", "NotAllowedError")),
    });
  });
  await panel.getByRole("button", { name: "Copy log", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText(
    "Could not copy the log",
  );
  await page.evaluate(() =>
    Reflect.deleteProperty(navigator.clipboard, "writeText"),
  );
  await panel.getByRole("button", { name: "Copy log", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("Log copied");
  const copied = JSON.parse(
    await page.evaluate(() => navigator.clipboard.readText()),
  ) as {
    threadId: string;
    received: number;
    retained: number;
    events: {
      runId: string;
      receivedAt: number;
      event: { type: string; stepName?: string };
    }[];
  };

  expect(copied.threadId).toBe(input.threadId);
  expect(copied.retained).toBe(copied.events.length);
  expect(copied.received).toBe(copied.retained);
  expect(copied.events[0]?.event.type).toBe("RUN_STARTED");
  expect(copied.events.at(-1)?.event.type).toBe("RUN_FINISHED");
  expect(
    copied.events.some((entry) => entry.event.type === "TEXT_MESSAGE_CONTENT"),
  ).toBe(true);
  expect(
    copied.events.some(
      (entry) => entry.event.type === "STEP_STARTED" && entry.event.stepName,
    ),
  ).toBe(true);
  expect(
    copied.events.every(
      (entry) => entry.runId === input.runId && entry.receivedAt > 0,
    ),
  ).toBe(true);
  const payload = start.getByLabel("Event payload");

  await expect(payload).toHaveText(
    JSON.stringify(copied.events[0]!.event, null, 2),
    { useInnerText: false },
  );
  await expect
    .poll(() => payload.locator("span[style]").count())
    .toBeGreaterThan(0);
  const categories = ["Run", "Step", "Message", "Tool"];
  const colors: string[] = [];

  for (const category of categories) {
    const badge = panel.getByText(category, { exact: true }).first();

    await expect(badge).toBeVisible();
    colors.push(
      await badge.evaluate((element) => getComputedStyle(element).color),
    );
  }

  expect(new Set(colors).size).toBe(categories.length);
  await start.locator("summary").click();
  await panel
    .getByText("RUN_FINISHED", { exact: true })
    .scrollIntoViewIfNeeded();
  const finished = panel
    .locator("details")
    .filter({ has: page.getByText("RUN_FINISHED", { exact: true }) });

  await finished.locator("summary").click();
  await expect(finished.getByLabel("Event payload")).toBeVisible();
  await expect(
    finished.getByLabel("Event payload").locator("span[style]").first(),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("activity-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  const bounds = await panel.boundingBox();

  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath("activity-mobile.png") });
  const lightColor = await finished
    .getByLabel("Event payload")
    .locator("span[style]")
    .first()
    .evaluate((element) => getComputedStyle(element).color);

  await page.evaluate(() => document.documentElement.classList.add("dark"));
  const darkColor = await finished
    .getByLabel("Event payload")
    .locator("span[style]")
    .first()
    .evaluate((element) => getComputedStyle(element).color);

  expect(darkColor).not.toBe(lightColor);
  await page.screenshot({
    path: testInfo.outputPath("activity-dark-mobile.png"),
  });
  await panel.getByRole("button", { name: "Clear log", exact: true }).click();
  await expect(
    panel.getByText("No activity yet", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close run activity" }).click();
  await expect(
    page.getByLabel("Assistant reply", { exact: true }),
  ).toContainText("UTC");
  await page.reload();
  await page.getByRole("button", { name: "Show run activity" }).click();
  await expect(
    panel.getByText("No activity yet", { exact: true }),
  ).toBeVisible();
});

test("merged activity updates an open stream and can switch back to each original delta", async ({
  page,
  request,
  context,
}, testInfo) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  const submitted = page.waitForRequest(
    (entry) =>
      entry.method() === "POST" && new URL(entry.url()).pathname === "/agent",
  );
  const composer = page.getByRole("textbox", { name: "Message" });

  await composer.fill("Stream a code sample.");
  await composer.press("Enter");
  const input = (await submitted).postDataJSON() as { threadId: string };

  await expect(
    page.getByLabel("Assistant reply", { exact: true }),
  ).toContainText("Here is a C example.");
  await page.getByRole("button", { name: "Show run activity" }).click();
  const panel = page.getByRole("complementary", { name: "Run activity" });
  const merged = panel
    .locator("details")
    .filter({ has: page.getByText("TEXT_MESSAGE_CONTENT", { exact: true }) });

  await merged.locator("summary").click();
  await expect(merged.getByLabel("Merged content")).toHaveText(
    "Here is a C example.\n\n",
    { useInnerText: false },
  );
  await expect(
    merged.getByText("End not received", { exact: true }),
  ).toBeVisible();
  const released = await request.post(
    `http://127.0.0.1:4300/__e2e/release/${input.threadId}`,
  );

  expect(released.ok()).toBe(true);
  const final =
    "Here is a C example.\n\n```c\nint main(void) {\n  return 0;\n}\n```";

  await expect(panel.getByText("RUN_FINISHED", { exact: true })).toBeVisible();
  await expect(merged.getByLabel("Merged content")).toHaveText(final, {
    useInnerText: false,
  });
  await expect(
    panel.getByText("TEXT_MESSAGE_CONTENT", { exact: true }),
  ).toHaveCount(1);
  await expect(merged.getByText("Complete", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await expect(composer).toBeVisible();
  await expect(composer).toBeEnabled();
  const desktopBounds = await panel.boundingBox();

  expect(desktopBounds!.width).toBeGreaterThanOrEqual(500);
  expect(desktopBounds!.width).toBeLessThanOrEqual(640);
  await merged.getByLabel("Merged content").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath("activity-merged-desktop.png"),
  });
  await panel.getByRole("button", { name: "Copy log", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("Log copied");
  const log = JSON.parse(
    await page.evaluate(() => navigator.clipboard.readText()),
  ) as { events: { event: { type: string; delta?: string } }[] };
  const fragments = log.events.filter(
    (entry) => entry.event.type === "TEXT_MESSAGE_CONTENT",
  );

  expect(fragments).toHaveLength(2);
  expect(fragments.map((entry) => entry.event.delta).join("")).toBe(final);
  await merged.getByText("Original events (2)", { exact: true }).click();
  await expect(merged.getByLabel("Event payload")).toHaveText(
    JSON.stringify(
      fragments.map(({ event }) => event),
      null,
      2,
    ),
    { useInnerText: false },
  );
  await merged.getByText("Original events (2)", { exact: true }).click();
  await panel.getByRole("checkbox", { name: "Merge stream content" }).uncheck();
  await expect(
    panel.getByText("TEXT_MESSAGE_CONTENT", { exact: true }),
  ).toHaveCount(2);
  const raw = panel
    .locator("details")
    .filter({ has: page.getByText("TEXT_MESSAGE_CONTENT", { exact: true }) })
    .first();

  await raw.locator("summary").click();
  await expect(raw.getByLabel("Event payload")).toContainText(
    JSON.stringify(fragments[1]!.event, null, 2),
  );
  await panel.getByRole("checkbox", { name: "Merge stream content" }).check();
  const restored = panel
    .locator("details")
    .filter({ has: page.getByText("TEXT_MESSAGE_CONTENT", { exact: true }) });

  await restored.locator("summary").click();
  await expect(restored.getByLabel("Merged content")).toHaveText(final, {
    useInnerText: false,
  });
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(composer).toBeHidden();
  const tabletBounds = await panel.boundingBox();

  expect(tabletBounds!.width).toBeGreaterThan(600);
  expect(tabletBounds!.x + tabletBounds!.width).toBeLessThanOrEqual(1024);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    1024,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(restored.getByLabel("Merged content")).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("activity-merged-mobile.png"),
  });
});

test("activity exposes client failures even when no protocol events arrive", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.route("**/agent", (route) =>
    route.fulfill({ status: 503, json: { error: "Transport unavailable" } }),
  );
  await page.goto("/");
  const composer = page.getByRole("textbox", { name: "Message" });

  await composer.fill("Inspect a connection failure");
  await composer.press("Enter");
  await expect(page.getByRole("alert").first()).toBeVisible();
  await page.getByRole("button", { name: "Show run activity" }).click();
  const panel = page.getByRole("complementary", { name: "Run activity" });

  await expect(panel.getByRole("alert")).toContainText("503");
  await panel.getByRole("button", { name: "Copy log", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("Log copied");
  const log = JSON.parse(
    await page.evaluate(() => navigator.clipboard.readText()),
  ) as { received: number; events: unknown[]; clientIssues: { run: string } };

  expect(log.received).toBe(0);
  expect(log.events).toEqual([]);
  expect(log.clientIssues.run).toContain("503");
});
