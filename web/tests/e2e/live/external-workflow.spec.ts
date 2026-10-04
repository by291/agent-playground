import { expect, test } from "@playwright/test";

test("a real asynchronous report updates live and completes after the page closes", async ({
  page,
  context,
  request,
}) => {
  await page.goto("/");
  const submitted = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/agent",
  );

  await page
    .getByRole("button", { name: "Generate report", exact: true })
    .click();
  await page.getByRole("textbox", { name: "Message" }).press("Enter");
  const { threadId } = (await submitted).postDataJSON() as { threadId: string };
  const task = page.getByLabel("Generate report");

  await expect(task).toContainText("Preparing report data");
  await expect(
    page.getByText("Waiting for external task", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message" })).toBeDisabled();
  await page.close();
  await expect
    .poll(
      async () => {
        const response = await request.get(
          "http://127.0.0.1:3000/conversations",
        );
        const conversations = (await response.json()) as {
          conversations: { threadId: string; status: string }[];
        };

        return conversations.conversations.find(
          (conversation) => conversation.threadId === threadId,
        )?.status;
      },
      { timeout: 90000 },
    )
    .toBe("completed");
  const restored = await context.newPage();

  await restored.goto(`/c/${threadId}`);
  await expect(restored.getByLabel("Generate report")).toContainText(
    "The report is ready",
  );
  await expect(
    restored.getByText("REPORT READY", { exact: true }),
  ).toBeVisible();
  await expect(
    restored.getByRole("textbox", { name: "Message" }),
  ).toBeEnabled();
  await restored.getByText("Task history", { exact: true }).click();
  await expect(restored.getByLabel("Generate report")).toContainText(
    "Processing report data",
  );
  await expect(restored.getByLabel("Generate report")).toContainText(
    "Finalizing the report",
  );
});
