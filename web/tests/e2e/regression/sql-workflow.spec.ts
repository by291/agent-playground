import { expect, test } from "../fixtures";
import type { Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { WorkflowReview } from "@shared/workflow-review";

async function send(page: Page, content: string) {
  const composer = page.getByRole("textbox", { name: "Message" });

  await expect(composer).toBeEnabled();
  await composer.fill(content);
  await composer.press("Enter");
}

test("SQL revisions and explanations survive reload and submit the accepted version", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const submitted = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/agent",
  );

  await page.getByRole("button", { name: "Review SQL", exact: true }).click();
  const composer = page.getByRole("textbox", { name: "Message" });

  await expect(composer).toHaveValue(
    "Start a SQL review workflow to list id and amount from paid orders.",
  );
  await expect(
    page.getByRole("heading", { name: "What would you like to work on?" }),
  ).toBeVisible();
  await composer.press("Enter");
  const { threadId } = (await submitted).postDataJSON() as { threadId: string };

  await expect(
    page.getByRole("button", { name: "Accept and submit" }),
  ).toBeEnabled();
  await expect(page.getByLabel("SQL workflow")).toContainText("Version 2");
  const initial = await request.get(
    `http://127.0.0.1:4300/conversations/${threadId}`,
  );
  const initialSnapshot = (await initial.json()) as {
    interrupts: {
      id: string;
      metadata: { langgraph: { raw: WorkflowReview } };
    }[];
  };
  const oldReview = initialSnapshot.interrupts[0]!;

  await page.reload();
  await expect(
    page.getByRole("button", { name: "Accept and submit" }),
  ).toBeEnabled();
  await send(page, "Explain this query");
  await expect(
    page.getByText(
      "Explicit columns keep the result predictable when the schema changes.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByLabel("SQL workflow")).toContainText("Version 2");
  await send(page, "Only amounts please");
  await expect(page.getByLabel("SQL workflow")).toContainText(
    "SELECT amount FROM orders;",
  );
  await expect(page.getByLabel("SQL workflow")).toContainText("Version 3");
  await page.reload();
  await expect(
    page.getByText("Explain this query", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Only amounts please", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Explicit columns keep the result predictable when the schema changes.",
      { exact: true },
    ),
  ).toHaveCount(1);
  const stale = await request.post("http://127.0.0.1:4300/agent", {
    data: {
      threadId,
      runId: randomUUID(),
      messages: [],
      state: {},
      tools: [],
      context: [],
      resume: [
        {
          interruptId: oldReview.id,
          status: "resolved",
          payload: {
            action: "accept",
            workflowCallId: oldReview.metadata.langgraph.raw.workflowCallId,
            revision: oldReview.metadata.langgraph.raw.revision,
            round: oldReview.metadata.langgraph.raw.round,
          },
        },
      ],
    },
  });

  expect(stale.status()).toBe(409);
  await page.getByRole("button", { name: "Accept and submit" }).click();
  await expect(page.getByLabel("SQL workflow")).toContainText("SQL submitted");
  await expect(page.getByLabel("SQL workflow")).toContainText("Receipt:");
  await expect(
    page.getByRole("button", { name: "Accept and submit" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Waiting for your review", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Used 1 tool", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("SQL workflow")).toContainText("SQL submitted");
  await expect(page.getByRole("textbox", { name: "Message" })).toBeEnabled();
});

test("SQL that fails rechecking cannot be submitted and can be abandoned", async ({
  page,
}) => {
  await page.goto("/");
  await send(page, "Use run_sql_workflow to show orders.");
  await expect(
    page.getByRole("button", { name: "Accept and submit" }),
  ).toBeEnabled();
  await send(page, "Use a wildcard instead");
  await expect(
    page.getByRole("button", { name: "Accept and submit" }),
  ).toBeDisabled();
  await expect(page.getByLabel("SQL workflow")).toContainText(
    "Changes required",
  );
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Accept and submit" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Abandon", exact: true }).click();
  await expect(page.getByLabel("SQL workflow")).toContainText("SQL abandoned");
  await expect(page.getByLabel("SQL workflow")).not.toContainText("Receipt:");
  await expect(
    page.getByRole("button", { name: "Waiting for your review", exact: true }),
  ).toHaveCount(0);
});
