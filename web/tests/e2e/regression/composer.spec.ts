import { expect, test, capture } from "../fixtures";

test("the configured model sits beside send and opens context details on desktop and mobile", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  const model = page.getByRole("button", {
    name: "test-model. Show details",
    exact: true,
  });
  const send = page.getByRole("button", { name: "Send message", exact: true });

  await page.getByRole("textbox", { name: "Message" }).fill("Keep this draft");

  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() =>
        page
          .locator("main")
          .evaluate((element) => element.getBoundingClientRect().bottom),
      )
      .toBe(900);
    await expect(model).toBeVisible();
    await expect(send).toBeVisible();
    await expect(
      page.locator("header").getByRole("button", { name: /test-model/ }),
    ).toHaveCount(0);
    // Responsive panel measurement completes after the viewport change.
    await expect
      .poll(async () => {
        const modelBounds = await model.boundingBox();
        const sendBounds = await send.boundingBox();

        if (!modelBounds || !sendBounds) {
          return Infinity;
        }

        return Math.abs(modelBounds.y - sendBounds.y);
      })
      .toBeLessThan(1);
    const modelBox = await model.boundingBox();
    const sendBox = await send.boundingBox();

    expect(modelBox).not.toBeNull();
    expect(sendBox).not.toBeNull();
    expect(modelBox!.x + modelBox!.width).toBeLessThan(sendBox!.x);
    expect(sendBox!.x + sendBox!.width).toBeLessThan(width);
    await model.click();
    await expect(page.getByLabel("Context usage details")).toBeVisible();
    const panel = await page.getByLabel("Context usage details").boundingBox();

    expect(panel!.y + panel!.height).toBeLessThan(modelBox!.y);
    await page.keyboard.press("Escape");
    await expect(model).toBeFocused();
    await expect(page.getByRole("textbox", { name: "Message" })).toHaveValue(
      "Keep this draft",
    );
    await capture(page, testInfo, `composer-${width}.png`);
  }
});
