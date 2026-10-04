import { expect, test } from "../fixtures";
import type { Page, Locator, APIRequestContext } from "@playwright/test";

async function sendLongReply(page: Page, animated = false) {
  const composer = page.getByRole("textbox", { name: "Message" });
  const finished = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/agent",
  );

  await composer.fill("Write a long reply.");
  await composer.press("Enter");
  await (await finished).finished();

  if (animated) {
    const reply = page.getByLabel("Assistant reply", { exact: true }).last();

    await expect(reply).toContainText("Paragraph 1:");
    await expect(reply).not.toContainText("End of the long reply.");
    await expect(composer).toBeDisabled();
  }

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

async function restoreHistory(page: Page, request: APIRequestContext) {
  const response = await request.post(
    "http://127.0.0.1:4300/__e2e/scroll-history",
  );

  expect(response.ok()).toBe(true);
  const { threadId } = (await response.json()) as { threadId: string };

  await page.goto(`/c/${threadId}`);
  await expect(page.getByLabel("Assistant reply", { exact: true })).toHaveCount(
    3,
  );
}

test("scrolling through restored long replies and code keeps the conversation height stable", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await restoreHistory(page, request);
  await page.evaluate(() => document.fonts.ready);
  const viewport = page.getByRole("region", { name: "Messages" });

  await expect.poll(() => distanceFromBottom(viewport)).toBeLessThanOrEqual(1);
  const initialHeight = await viewport.evaluate(
    (element) => element.scrollHeight,
  );

  expect(initialHeight).toBeGreaterThan(2_000);
  await viewport.hover();

  // Exercise wheel scrolling at the bottom, middle and top, rather than every pixel.
  for (const fraction of [1, 0.5, 0]) {
    await viewport.evaluate((element, fraction) => {
      element.scrollTop =
        (element.scrollHeight - element.clientHeight) * fraction;
    }, fraction);
    const position = await viewport.evaluate((element) => element.scrollTop);

    await page.mouse.wheel(0, fraction === 0 ? 300 : -300);
    await expect
      .poll(() => viewport.evaluate((element) => element.scrollTop))
      .not.toBe(position);
    expect(await viewport.evaluate((element) => element.scrollHeight)).toBe(
      initialHeight,
    );
  }

  await page.mouse.wheel(0, -100_000);
  await expect
    .poll(() => viewport.evaluate((element) => element.scrollTop))
    .toBe(0);
  expect(await viewport.evaluate((element) => element.scrollTop)).toBe(0);
  await page.mouse.wheel(0, 100_000);
  await expect.poll(() => distanceFromBottom(viewport)).toBeLessThanOrEqual(1);
  expect(await viewport.evaluate((element) => element.scrollHeight)).toBe(
    initialHeight,
  );
});

test.describe("animated scrolling", () => {
  test.use({ replyAnimation: true, reducedMotion: "no-preference" });

  test("returning to the bottom resumes following the next reply even after another downward wheel", async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await restoreHistory(page, request);
    const viewport = page.getByRole("region", { name: "Messages" });

    await expect
      .poll(() => distanceFromBottom(viewport))
      .toBeLessThanOrEqual(1);
    await viewport.hover();
    await page.mouse.wheel(0, -500);
    await expect.poll(() => distanceFromBottom(viewport)).toBeGreaterThan(200);
    await page.mouse.wheel(0, 100_000);
    await expect
      .poll(() => distanceFromBottom(viewport))
      .toBeLessThanOrEqual(1);
    await page.mouse.wheel(0, 120);
    await sendLongReply(page, true);
    await expect
      .poll(() => distanceFromBottom(viewport))
      .toBeLessThanOrEqual(1);
  });
});

test("sending while reading earlier messages preserves the reading position", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await restoreHistory(page, request);
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
