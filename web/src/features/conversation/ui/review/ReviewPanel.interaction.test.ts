import "../../../../../tests/dom";
import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { createElement } from "react";
import { cleanup, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReviewPanel } from "./ReviewPanel";
import type { PlanReviewResponse } from "../../model/planReview";

afterEach(cleanup);

void test("review approval submits edited values and running prevents another decision", async () => {
  const decisions: PlanReviewResponse[][] = [];
  const props = {
    reviews: [
      {
        interruptId: "review",
        title: "Original plan",
        steps: ["Original step"],
      },
    ],
    running: false,
    onReview: (responses: PlanReviewResponse[]) => {
      decisions.push(responses);

      return Promise.resolve();
    },
  };
  const page = render(createElement(ReviewPanel, props));
  const user = userEvent.setup();

  await user.clear(page.getByLabelText("Title"));
  assert.equal(
    page.getByRole("button", { name: "Approve plan" }).hasAttribute("disabled"),
    true,
  );
  await user.type(page.getByLabelText("Title"), "  Edited plan  ");
  await user.clear(page.getByLabelText("Steps, one per line"));
  await user.type(
    page.getByLabelText("Steps, one per line"),
    "  First step  {Enter}{Enter}Second step",
  );
  await user.click(page.getByRole("button", { name: "Approve plan" }));

  assert.deepEqual(decisions, [
    [
      {
        interruptId: "review",
        decision: "approve",
        title: "Edited plan",
        steps: ["First step", "Second step"],
      },
    ],
  ]);
  page.rerender(createElement(ReviewPanel, { ...props, running: true }));
  await user.click(page.getByRole("button", { name: "Reject" }));

  assert.equal(decisions.length, 1);
  const title = page.getByLabelText("Title");

  assert.ok(title instanceof HTMLInputElement);
  assert.equal(title.value, "  Edited plan  ");
});
