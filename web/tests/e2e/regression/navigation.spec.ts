import { expect, test } from "../fixtures";

test("sidebar dragging and keyboard resizing survive collapse and reload without losing the draft", async ({
  page,
}) => {
  await page.goto("/");
  const composer = page.getByRole("textbox", { name: "Message" });
  const separator = page.getByRole("separator", { name: "Sidebar width" });
  const sidebar = page.getByRole("complementary", {
    name: "Conversation navigation",
  });

  await composer.fill("Keep this unfinished task");
  await expect
    .poll(async () => (await sidebar.boundingBox())!.width)
    .toBeCloseTo(320, 0);
  await separator.press("ArrowRight");
  await expect
    .poll(async () => (await sidebar.boundingBox())!.width)
    .toBeGreaterThan(320);
  const keyboardWidth = (await sidebar.boundingBox())!.width;
  const ariaSize = Number(await separator.getAttribute("aria-valuenow"));

  expect(ariaSize).toBeGreaterThan(0);
  expect(ariaSize).toBeLessThan(100);
  const handle = (await separator.boundingBox())!;

  await page.mouse.move(handle.x + handle.width / 2, handle.y + 100);
  await page.mouse.down();
  await expect(separator).toHaveAttribute("data-separator", "active");
  await page.mouse.move(handle.x + handle.width / 2 + 24, handle.y + 100, {
    steps: 6,
  });
  await page.mouse.up();
  await expect(separator).not.toHaveAttribute("data-separator", "active");
  await expect
    .poll(async () => (await sidebar.boundingBox())!.width)
    .toBeCloseTo(keyboardWidth + 24, 0);
  const savedWidth = (await sidebar.boundingBox())!.width;

  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect
    .poll(async () => (await sidebar.boundingBox())!.width)
    .toBeCloseTo(64, 0);
  await expect(composer).toHaveValue("Keep this unfinished task");
  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await expect
    .poll(async () => (await sidebar.boundingBox())!.width)
    .toBeCloseTo(savedWidth, 0);
  await separator.press("Home");
  await expect
    .poll(async () => (await sidebar.boundingBox())!.width)
    .toBeCloseTo(240, 0);
  await separator.press("End");
  await expect
    .poll(async () => (await sidebar.boundingBox())!.width)
    .toBeCloseTo(420, 0);
  await page.reload();
  await expect
    .poll(async () => (await sidebar.boundingBox())!.width)
    .toBeCloseTo(420, 0);
});

test("mobile Sheet navigation preserves the desktop draft and restores focus", async ({
  page,
}) => {
  await page.goto("/");
  const composer = page.getByRole("textbox", { name: "Message" });

  await composer.fill("Retain this draft across screen sizes");
  await page.setViewportSize({ width: 390, height: 844 });
  const trigger = page.getByRole("button", { name: "Open navigation" });

  await trigger.click();
  const navigation = page.getByRole("dialog", {
    name: "Conversation navigation",
  });

  await expect(navigation).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(navigation).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(composer).toHaveValue("Retain this draft across screen sizes");
  await trigger.click();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(navigation).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Collapse sidebar" }),
  ).toBeFocused();
  await expect(composer).toHaveValue("Retain this draft across screen sizes");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(navigation).toHaveCount(0);
});
