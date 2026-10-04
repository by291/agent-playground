import { expect, test } from "../fixtures";

test("external progress updates live, and a closed conversation completes in the background", async ({
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

  await expect(page.getByLabel("Generate report")).toContainText(
    "Waiting for external updates",
  );
  await expect(page.getByRole("textbox", { name: "Message" })).toBeDisabled();
  await expect(page.getByRole("textbox", { name: "Message" })).toHaveAttribute(
    "placeholder",
    /external task/,
  );
  const fixture = await request.get(
    `http://127.0.0.1:4300/__e2e/external-task/${threadId}`,
  );
  const { taskId, callbackToken } = (await fixture.json()) as {
    taskId: string;
    callbackToken: string;
  };
  const update = async (revision: number, status: string, message: string) => {
    const response = await request.post(
      `http://127.0.0.1:4300/external-tasks/${taskId}/events`,
      {
        headers: { Authorization: `Bearer ${callbackToken}` },
        data: {
          revision,
          status,
          stage: message,
          message,
          progress: revision * 20,
          ...(status === "succeeded"
            ? { result: { summary: "The generated report" } }
            : {}),
        },
      },
    );

    expect(response.ok()).toBe(true);
  };

  await update(1, "running", "Preparing data");
  await expect(page.getByLabel("Generate report")).toContainText(
    "Preparing data",
  );
  await update(2, "running", "Analyzing data");
  await expect(page.getByLabel("Generate report")).toContainText(
    "Analyzing data",
  );
  await page.close();
  await update(3, "succeeded", "Report ready");
  await update(3, "succeeded", "Report ready");
  await expect
    .poll(async () => {
      const response = await request.get(
        `http://127.0.0.1:4300/__e2e/stored-conversation/${threadId}`,
      );
      const snapshot = (await response.json()) as {
        messages: { content: string }[];
      };

      return snapshot.messages.some(
        (message) => message.content === "The report is ready.",
      );
    })
    .toBe(true);
  const restored = await context.newPage();

  await restored.goto(`/c/${threadId}`);
  await expect(restored.getByLabel("Generate report")).toContainText(
    "Report ready",
  );
  await expect(
    restored.getByText("The report is ready.", { exact: true }),
  ).toHaveCount(1);
  await expect(
    restored.getByRole("textbox", { name: "Message" }),
  ).toBeEnabled();
  await restored.getByText("Task history", { exact: true }).click();
  await expect(restored.getByLabel("Generate report")).toContainText(
    "Preparing data",
  );
});
