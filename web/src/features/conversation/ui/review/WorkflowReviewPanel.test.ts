// @vitest-environment jsdom
import { expect, test } from "vitest";
import { createElement } from "react";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkflowReviewPanel } from "./WorkflowReviewPanel";
import type { WorkflowReview } from "@shared/workflow-review";

test("failed copy can be abandoned but not accepted, and a running review disables decisions", async () => {
  const review: WorkflowReview = {
    kind: "workflow_review",
    interruptId: "review",
    workflowCallId: "call",
    revision: 1,
    round: 1,
    outputStepId: "review:1",
    canAccept: false,
    title: "Copy decision",
    acceptLabel: "Accept copy",
    messagePlaceholder: "Discuss this copy…",
    blockedReason: "Resolve the factual issue first.",
  };
  const actions: string[] = [];
  const props = {
    reviews: [review],
    running: false,
    onReview: (_review: WorkflowReview, action: "accept" | "abandon") => {
      actions.push(action);

      return Promise.resolve();
    },
  };
  const page = render(createElement(WorkflowReviewPanel, props));
  const user = userEvent.setup();

  expect(page.getByRole("button", { name: "Accept copy" })).toBeDisabled();
  await user.click(page.getByRole("button", { name: "Abandon" }));
  expect(actions).toEqual(["abandon"]);
  page.rerender(
    createElement(WorkflowReviewPanel, { ...props, running: true }),
  );
  expect(page.getByRole("button", { name: "Abandon" })).toBeDisabled();
});
