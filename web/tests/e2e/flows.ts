import { expect, type Page } from "@playwright/test";

export const timePrompt = "Use the time tool to tell me the current UTC time.";
export const reviewPrompt =
  "Use run_experiment_workflow to make a simple experiment plan for testing an agent workflow. Ask me to review it.";

export async function verifyFreshWelcome(page: Page) {
  await page
    .getByRole("button", { name: "New conversation", exact: true })
    .filter({ visible: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "What would you like to work on?" }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message" })).toBeEnabled();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "What would you like to work on?" }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message" })).toBeEnabled();
}

export async function verifyToolReply(page: Page) {
  await page.getByRole("textbox", { name: "Message" }).fill(timePrompt);
  await page.getByRole("textbox", { name: "Message" }).press("Enter");
  const tools = page.getByRole("button", {
    name: /Tool.*get_current_time.*Completed/,
  });
  const reply = page.getByLabel("Assistant reply", { exact: true });

  await expect(tools).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message" })).toBeEnabled();
  await expect(reply).toContainText("UTC");
  await expect(reply).toHaveCount(1);
  await expect(tools).toHaveAttribute("aria-expanded", "false");
  await tools.click();
  await page.getByRole("button", { name: /Check the time/ }).click();
  await expect(
    page.locator("code").filter({ hasText: /^get_current_time$/ }),
  ).toBeVisible();
  await page.reload();
  await expect(tools).toBeVisible();
  await expect(tools).toHaveAttribute("aria-expanded", "false");
  await expect(reply).toHaveCount(1);
  await expect(reply).toContainText("UTC");
}

export async function startWorkflowReview(page: Page) {
  await page.getByRole("textbox", { name: "Message" }).fill(reviewPrompt);
  await page.getByRole("textbox", { name: "Message" }).press("Enter");
  await expect(
    page.getByRole("button", { name: "Approve plan" }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message" })).toBeDisabled();
}

export async function approveWorkflowReview(page: Page) {
  const title = "Frontend architecture smoke plan";

  await page.getByLabel("Title", { exact: true }).fill(title);
  await page
    .getByLabel("Steps, one per line")
    .fill("Check streaming\nCheck recovery");
  await page.getByRole("button", { name: "Approve plan" }).click();
  await expect(page.getByRole("textbox", { name: "Message" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Approve plan" })).toHaveCount(
    0,
  );
  await expect(page.getByLabel("Assistant reply", { exact: true })).toHaveCount(
    1,
  );
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: /Tool.*run_experiment_workflow.*Completed/,
    }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve plan" })).toHaveCount(
    0,
  );
  await expect(page.getByLabel("Assistant reply", { exact: true })).toHaveCount(
    1,
  );
  await expect(page.getByRole("region", { name: "Messages" })).toContainText(
    title,
  );
}

export async function verifyGallerySelection(page: Page) {
  const selector = page.getByRole("combobox", {
    name: "Component",
    exact: true,
  });

  await selector.click();
  await page.getByRole("option", { name: "WorkflowText", exact: true }).click();
  await expect(selector).toContainText("WorkflowText");
  await expect(
    page.getByRole("status").filter({ hasText: "Valid A2UI JSON" }),
  ).toBeVisible();
  const preview = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Rendered preview", exact: true }),
  });

  await expect(
    preview.getByRole("heading", { name: "A clear heading", exact: true }),
  ).toBeVisible();
  await expect(preview).toContainText(
    "Supporting context stays readable at any width.",
  );
  await expect(preview.getByRole("alert")).toHaveCount(0);
}
