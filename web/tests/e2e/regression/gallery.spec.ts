import { expect, test } from "../fixtures";
import { verifyGallerySelection } from "../flows";

test("the development gallery selects a valid WorkflowText preview", async ({
  page,
}) => {
  const errors: string[] = [];

  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/dev/a2ui-components");
  await verifyGallerySelection(page);
  const editor = page.getByRole("textbox", {
    name: "WorkflowText JSON editor",
  });

  await expect(editor).toBeVisible();
  await editor.press("ControlOrMeta+End");
  await editor.press("ArrowUp");
  await expect(
    page.getByRole("heading", { name: "A clear heading", exact: true }),
  ).toBeVisible();
  await editor.press("ControlOrMeta+A");
  await page.keyboard.insertText("{");
  await expect(
    page.getByRole("alert").filter({ hasText: "Enter valid JSON" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "A clear heading", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Valid A2UI JSON" }),
  ).toBeVisible();
  await expect(editor).toBeVisible();
  expect(errors).toEqual([]);
});
