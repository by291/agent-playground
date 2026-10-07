import { resolve } from "node:path";
import { expect, test } from "../fixtures";

test("agent handoffs stream Markdown, survive reload and complete with the page closed", async ({
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
    .getByRole("button", { name: "Collaborate with agents", exact: true })
    .click();
  await page.getByRole("textbox", { name: "Message" }).press("Enter");
  const { threadId } = (await submitted).postDataJSON() as { threadId: string };

  await expect(
    page.getByLabel("A2A collaboration", { exact: true }),
  ).toBeVisible();
  const fixture = await request.get(
    `http://127.0.0.1:4300/__e2e/external-task/${threadId}`,
  );
  const { taskId, callbackToken } = (await fixture.json()) as {
    taskId: string;
    callbackToken: string;
  };
  const outputs = [
    {
      agent: "Planner",
      step: "plan",
      taskId: "remote-plan",
      contextId: "planner-context",
      status: "running",
      text: "## Initial proposal\n\nFirst proposal paragraph.",
    },
  ];
  const revisionText = [
    "## Revised proposal",
    "",
    "A **practical** session with a completion check.",
    "",
    "| Time | Activity |",
    "| --- | --- |",
    "| 10 min | Agent handoff |",
    "",
    "- Capture the task ID",
    "- Verify completion",
    "",
    "```json",
    '{ "state": "completed" }',
    "```",
  ].join("\n");
  const update = async (revision: number, status = "running") => {
    const response = await request.post(
      `http://127.0.0.1:4300/external-tasks/${taskId}/events`,
      {
        headers: { Authorization: `Bearer ${callbackToken}` },
        data: {
          revision,
          kind: "a2a",
          status,
          stage: outputs.at(-1)!.step,
          message: "Agents are collaborating",
          outputs,
          ...(status === "succeeded"
            ? { result: { summary: revisionText } }
            : {}),
        },
      },
    );

    expect(response.ok()).toBe(true);
  };

  await update(1);
  await expect(
    page.getByRole("heading", { name: "Initial proposal", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Planner plan", { exact: true })).toContainText(
    "First proposal paragraph.",
  );
  outputs[0]!.text += "\n\n**Second paragraph arrives.**";
  await update(2);
  await expect(page.getByLabel("Planner plan", { exact: true })).toContainText(
    "Second paragraph arrives.",
  );
  await page.reload();
  await expect(page.getByLabel("Planner plan", { exact: true })).toContainText(
    "Second paragraph arrives.",
  );
  outputs[0]!.status = "succeeded";
  outputs.push({
    agent: "Reviewer",
    step: "review",
    taskId: "remote-review",
    contextId: "reviewer-context",
    status: "running",
    text: "Review feedback is arriving.",
  });
  await update(3);
  await expect(
    page.getByLabel("Reviewer review", { exact: true }),
  ).toContainText("Review feedback is arriving.");
  await expect(
    page.getByRole("heading", { name: "Initial proposal", exact: true }),
  ).toBeHidden();
  await page.close();
  outputs[1]!.status = "succeeded";
  outputs.push({
    agent: "Planner",
    step: "revise",
    taskId: "remote-revise",
    contextId: "planner-context",
    status: "succeeded",
    text: revisionText,
  });
  await update(4, "succeeded");
  await expect
    .poll(
      async () => {
        const response = await request.get(
          `http://127.0.0.1:4300/__e2e/stored-conversation/${threadId}`,
        );
        const snapshot = (await response.json()) as {
          messages: { content: string }[];
        };

        return snapshot.messages.some(
          (message) => message.content === "The A2A collaboration is ready.",
        );
      },
      { intervals: [100] },
    )
    .toBe(true);

  const restored = await context.newPage();

  await restored.goto(`/c/${threadId}`);
  await expect(
    restored.getByLabel("Planner revise", { exact: true }),
  ).toContainText("Revised proposal");
  await expect(
    restored.getByRole("heading", { name: "Revised proposal", exact: true }),
  ).toHaveCount(1);
  await expect(restored.getByRole("table")).toBeVisible();
  await expect(
    restored.locator('[data-streamdown="code-block"]'),
  ).toContainText('"state"');
  await expect(
    restored.getByText("A2A collaboration completed", { exact: true }),
  ).toBeVisible();
  await expect(
    restored.getByRole("heading", { name: "Initial proposal", exact: true }),
  ).toBeHidden();
  await restored.getByRole("button", { name: /Draft · Planner/ }).click();
  await expect(
    restored.getByRole("heading", { name: "Initial proposal", exact: true }),
  ).toBeVisible();
  await restored.getByRole("button", { name: /Draft · Planner/ }).click();
  await expect(
    restored.getByRole("textbox", { name: "Message" }),
  ).toBeEnabled();
  await expect(
    restored.getByText("The A2A collaboration is ready.", { exact: true }),
  ).toHaveCount(1);
  await restored
    .getByLabel("Planner revise", { exact: true })
    .scrollIntoViewIfNeeded();
  await restored.screenshot({
    path: resolve("../.dev/a2a-markdown-regression.png"),
    fullPage: true,
    animations: "disabled",
  });
});
