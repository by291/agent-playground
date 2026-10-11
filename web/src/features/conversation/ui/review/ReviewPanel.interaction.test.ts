// @vitest-environment jsdom
import { test } from "vitest";
import assert from "node:assert/strict";
import { createElement } from "react";
import { render, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReviewPanel } from "./ReviewPanel";
import type { PlanReviewResponse } from "../../model/plan-review";

test("review approval submits edited values and running prevents another decision", async () => {
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

test("batch decisions are exclusive keyboard choices and submit only after every plan is decided", async () => {
  const decisions: PlanReviewResponse[][] = [];
  const page = render(
    createElement(ReviewPanel, {
      reviews: [
        { interruptId: "first", title: "First plan", steps: ["First step"] },
        { interruptId: "second", title: "Second plan", steps: ["Second step"] },
      ],
      running: false,
      onReview: (responses: PlanReviewResponse[]) => {
        decisions.push(responses);

        return Promise.resolve();
      },
    }),
  );
  const user = userEvent.setup();
  const first = within(
    page.getByRole("radiogroup", { name: "Decision for plan 1" }),
  );
  const second = within(
    page.getByRole("radiogroup", { name: "Decision for plan 2" }),
  );
  const continueButton = page.getByRole("button", {
    name: "Continue workflow",
  });

  assert.equal(continueButton.hasAttribute("disabled"), true);
  await user.click(first.getByRole("radio", { name: "Reject" }));
  // Radix defers arrow focus until after keydown. Hold it through that focus change.
  await user.keyboard("{ArrowLeft>}");
  await waitFor(() =>
    assert.equal(
      first
        .getByRole("radio", { name: "Approve plan" })
        .getAttribute("aria-checked"),
      "true",
    ),
  );
  await user.keyboard("{/ArrowLeft}");
  assert.equal(
    first.getByRole("radio", { name: "Reject" }).getAttribute("aria-checked"),
    "false",
  );
  assert.equal(continueButton.hasAttribute("disabled"), true);
  assert.deepEqual(decisions, []);
  await user.click(second.getByRole("radio", { name: "Reject" }));
  await user.click(continueButton);

  assert.deepEqual(decisions, [
    [
      {
        interruptId: "first",
        title: "First plan",
        steps: ["First step"],
        decision: "approve",
      },
      {
        interruptId: "second",
        title: "Second plan",
        steps: ["Second step"],
        decision: "reject",
      },
    ],
  ]);
});
