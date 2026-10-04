import { expect, test } from "./fixtures";

test("a real asynchronous report updates live and completes after the page closes", async ({
  page,
  context,
  request,
  createConversation,
}) => {
  const ownedThreadId = await createConversation();
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

  expect(threadId).toBe(ownedThreadId);
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
        const response = await request.get(`/conversations/${threadId}`);

        expect(response.ok()).toBe(true);
        const snapshot = (await response.json()) as {
          externalTasks: { status: string }[];
          messages: { role: string; content: string }[];
          runs: { status: string }[];
        };

        return (
          snapshot.externalTasks.some((task) => task.status === "succeeded") &&
          snapshot.runs.at(-1)?.status === "completed" &&
          snapshot.messages.some(
            (message) =>
              message.role === "assistant" && message.content.length > 0,
          )
        );
      },
      { timeout: 90000 },
    )
    .toBe(true);
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
