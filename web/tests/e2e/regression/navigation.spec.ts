import { expect, test } from "../fixtures";

test("sidebar dragging and keyboard resizing survive collapse and reload without losing the draft", async ({
  page,
}) => {
  await page.goto("/");
  const composer = page.getByRole("textbox", { name: "Message" });
  const separator = page.getByRole("separator", { name: "Sidebar width" });

  await composer.fill("Keep this unfinished task");
  await separator.press("ArrowRight");
  await expect(separator).toHaveAttribute("aria-valuenow", "336");
  const sidebar = page.getByRole("complementary", {
    name: "Conversation navigation",
  });

  await expect.poll(async () => (await sidebar.boundingBox())!.width).toBe(336);
  const handle = await separator.boundingBox();

  expect(handle).not.toBeNull();
  await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + 100);
  await page.mouse.down();
  await expect
    .poll(() => page.evaluate(() => document.body.style.cursor))
    .toBe("col-resize");
  await page.mouse.move(handle!.x + handle!.width / 2 + 48, handle!.y + 100, {
    steps: 6,
  });
  await page.mouse.up();
  await expect(separator).toHaveAttribute("aria-valuenow", "384");
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(
    page.getByRole("button", { name: "Expand sidebar" }),
  ).toBeVisible();
  await expect(composer).toHaveValue("Keep this unfinished task");
  await page.reload();
  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await expect(separator).toHaveAttribute("aria-valuenow", "384");
});
