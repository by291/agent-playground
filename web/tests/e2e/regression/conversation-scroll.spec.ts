import { expect, test, type Page, type Locator } from "@playwright/test";

async function sendLongReply(page: Page) {
  const composer = page.getByRole("textbox", { name: "Message" });

  await composer.fill("Write a long reply.");
  await composer.press("Enter");
  await expect(
    page.getByLabel("Assistant reply", { exact: true }).last(),
  ).toContainText("End of the long reply.");
  await expect(composer).toBeEnabled();
}

function distanceFromBottom(viewport: Locator) {
  return viewport.evaluate(
    (element) =>
      element.scrollHeight - element.clientHeight - element.scrollTop,
  );
}

test("scrolling through restored long replies and code keeps the conversation height stable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const messages = Array.from({ length: 8 }, (_, turn) => [
    { id: `user-${turn}`, role: "user", content: `Saved question ${turn}` },
    {
      id: `assistant-${turn}`,
      role: "assistant",
      content:
        Array.from(
          { length: 40 },
          (_, paragraph) =>
            `Paragraph ${paragraph}: This saved reply contains enough text to exercise scrolling through a long conversation without changing its layout.`,
        ).join("\n\n") +
        "\n\n```typescript\n" +
        Array.from(
          { length: 30 },
          (_, line) => `const value${line} = ${line};`,
        ).join("\n") +
        "\n```",
    },
  ]).flat();

  await page.route("**/conversations/scroll-history", (route) =>
    route.fulfill({
      json: {
        messages,
        outputs: [],
        interrupts: [],
        runs: [{ runId: "saved-run", status: "completed" }],
      },
    }),
  );
  await page.goto("/c/scroll-history");
  await expect(page.getByLabel("Assistant reply", { exact: true })).toHaveCount(
    8,
  );
  await page.evaluate(() => document.fonts.ready);
  const viewport = page.getByRole("region", { name: "Messages" });

  await expect.poll(() => distanceFromBottom(viewport)).toBeLessThanOrEqual(1);
  const initialHeight = await viewport.evaluate(
    (element) => element.scrollHeight,
  );

  expect(initialHeight).toBeGreaterThan(5_000);
  await viewport.hover();

  for (let step = 0; step < 40; step += 1) {
    const position = await viewport.evaluate((element) => element.scrollTop);

    if (position <= 0) {
      break;
    }

    await page.mouse.wheel(0, -800);
    await expect
      .poll(() => viewport.evaluate((element) => element.scrollTop))
      .not.toBe(position);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    expect(await viewport.evaluate((element) => element.scrollHeight)).toBe(
      initialHeight,
    );
  }

  expect(await viewport.evaluate((element) => element.scrollTop)).toBe(0);
  await page.mouse.wheel(0, 100_000);
  await expect.poll(() => distanceFromBottom(viewport)).toBeLessThanOrEqual(1);
  expect(await viewport.evaluate((element) => element.scrollHeight)).toBe(
    initialHeight,
  );
});

test("returning to the bottom resumes following the next reply even after another downward wheel", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await sendLongReply(page);
  const viewport = page.getByRole("region", { name: "Messages" });

  await expect.poll(() => distanceFromBottom(viewport)).toBeLessThanOrEqual(1);
  await viewport.hover();
  await page.mouse.wheel(0, -500);
  await expect.poll(() => distanceFromBottom(viewport)).toBeGreaterThan(200);
  await page.mouse.wheel(0, 100_000);
  await expect.poll(() => distanceFromBottom(viewport)).toBeLessThanOrEqual(1);
  await page.mouse.wheel(0, 120);
  await sendLongReply(page);
  await expect.poll(() => distanceFromBottom(viewport)).toBeLessThanOrEqual(1);
});

test("sending while reading earlier messages preserves the reading position", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await sendLongReply(page);
  const viewport = page.getByRole("region", { name: "Messages" });

  await viewport.hover();
  await page.mouse.wheel(0, -500);
  await expect.poll(() => distanceFromBottom(viewport)).toBeGreaterThan(200);
  const readingPosition = await viewport.evaluate(
    (element) => element.scrollTop,
  );

  await sendLongReply(page);
  await expect
    .poll(() => viewport.evaluate((element) => element.scrollTop))
    .toBeCloseTo(readingPosition, 0);
  await expect.poll(() => distanceFromBottom(viewport)).toBeGreaterThan(200);
});
