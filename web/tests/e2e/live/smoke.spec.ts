import { expect, test } from "./fixtures";
import {
  approveWorkflowReview,
  startWorkflowReview,
  verifyGallerySelection,
  verifyToolReply,
} from "../flows";

test("a real agent tool reply survives refresh", async ({
  page,
  createConversation,
}) => {
  await createConversation();
  await verifyToolReply(page);
});

test("a real workflow pauses, restores and resumes the edited review", async ({
  page,
  createConversation,
}) => {
  await createConversation();
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
