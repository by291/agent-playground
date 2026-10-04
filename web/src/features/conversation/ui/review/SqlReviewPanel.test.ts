// @vitest-environment jsdom
import { expect, test } from "vitest";
import { createElement } from "react";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SqlReviewPanel } from "./SqlReviewPanel";
import type { SqlReview } from "@shared/sql-review";

test("failed SQL can be abandoned but not accepted, and a running review disables decisions", async () => {
  const review: SqlReview = {
    kind: "sql_review",
    interruptId: "review",
    workflowCallId: "call",
    sql: "SELECT * FROM orders",
    originalSql: "SELECT * FROM orders",
    revision: 1,
    round: 1,
    outputStepId: "review:1",
    check: { passed: false, issues: ["Select columns"] },
  };
  const actions: string[] = [];
  const props = {
    reviews: [review],
    running: false,
    onReview: (_review: SqlReview, action: "accept" | "abandon") => {
      actions.push(action);

      return Promise.resolve();
    },
  };
  const page = render(createElement(SqlReviewPanel, props));
  const user = userEvent.setup();

  expect(
    page.getByRole("button", { name: "Accept and submit" }),
  ).toBeDisabled();
  await user.click(page.getByRole("button", { name: "Abandon" }));
  expect(actions).toEqual(["abandon"]);
  page.rerender(createElement(SqlReviewPanel, { ...props, running: true }));
  expect(page.getByRole("button", { name: "Abandon" })).toBeDisabled();
});
