import { expect, test } from "./fixtures";
import { parseWorkflowReview } from "@shared/workflow-review";

test("a real SQL agent revises, explains, restores and submits checked SQL", async ({
  page,
  request,
  createConversation,
}) => {
  const threadId = await createConversation();
  const composer = page.getByRole("textbox", { name: "Message" });

  await page.getByRole("button", { name: "Review SQL", exact: true }).click();
  await expect(composer).toHaveValue(
    "Start a SQL review workflow to list id and amount from paid orders.",
  );
  await composer.press("Enter");
  await expect(
    page.getByRole("button", { name: "Accept and submit" }),
  ).toBeEnabled();
  await expect(page.getByLabel("SQL workflow")).toContainText("Check passed");
  const version = await page.getByLabel("SQL workflow").innerText();
  const readReview = async () => {
    const response = await request.get(`/conversations/${threadId}`);

    expect(response.ok()).toBe(true);
    const snapshot = (await response.json()) as {
      interrupts: { id: string; metadata?: unknown }[];
    };

    return snapshot.interrupts
      .map(parseWorkflowReview)
      .find((review) => review !== null);
  };
  const originalReview = await readReview();

  expect(originalReview).toBeTruthy();
  const replies = page.getByLabel("Assistant reply", { exact: true });
  const originalReplyCount = await replies.count();

  await expect(composer).toBeEnabled();
  await composer.fill("Explain this query without modifying the SQL.");
  await composer.press("Enter");
  await expect
    .poll(async () => (await readReview())?.round)
    .toBe(originalReview!.round + 1);
  await expect
    .poll(async () => (await readReview())?.revision)
    .toBe(originalReview!.revision);
  await expect(replies).toHaveCount(originalReplyCount + 1);
  await expect(replies.last()).not.toBeEmpty();
  await expect(
    page.getByRole("button", { name: "Accept and submit" }),
  ).toBeEnabled();
  await expect(composer).toBeEnabled();
  await expect(page.getByLabel("SQL workflow")).toContainText(
    /Version \d+/.exec(version)![0],
  );
  await composer.fill(
    "Change the SQL to return only id. Keep the paid status filter and provide the complete revised SQL.",
  );
  await composer.press("Enter");
  await expect(page.getByLabel("SQL workflow")).toContainText(
    `Version ${Number(/Version (\d+)/.exec(version)![1]) + 1}`,
  );
  await expect(
    page.getByRole("button", { name: "Accept and submit" }),
  ).toBeEnabled();
  await page.reload();
  await expect(
    page.getByText("Explain this query without modifying the SQL.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Accept and submit" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Accept and submit" }).click();
  await expect(page.getByLabel("SQL workflow")).toContainText("SQL submitted");
  await expect(page.getByLabel("SQL workflow")).toContainText("Receipt:");
  await expect(composer).toBeEnabled();
  await page.reload();
  await expect(page.getByLabel("SQL workflow")).toContainText("SQL submitted");
});
