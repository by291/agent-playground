import { test } from "@playwright/test";
import { verifyGallerySelection } from "../flows";

test("the development gallery selects a valid WorkflowText preview", async ({
  page,
}) => {
  await page.goto("/dev/a2ui-components");
  await verifyGallerySelection(page);
});
