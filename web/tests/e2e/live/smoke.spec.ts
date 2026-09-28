import { expect, test } from "@playwright/test";
import {
  approveWorkflowReview,
  startWorkflowReview,
  verifyFreshWelcome,
  verifyGallerySelection,
  verifyToolReply,
} from "../flows";

test("a real agent tool reply survives refresh", async ({ page }) => {
  await page.goto("/");
  await verifyFreshWelcome(page);
  await verifyToolReply(page);
});

test("a real workflow pauses, restores and resumes the edited review", async ({
  page,
}) => {
  await page.goto("/");
  await startWorkflowReview(page);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Approve plan" }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message" })).toBeDisabled();
  await approveWorkflowReview(page);
});

test("the live development gallery selects a valid preview", async ({
  page,
}) => {
  await page.goto("/dev/a2ui-components");
  await verifyGallerySelection(page);
});
