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
