import { test } from "vitest";
import assert from "node:assert/strict";
import { InterruptSchema } from "@shared/ag-ui-schemas";
import { parsePlanReview, reviewEntries } from "./plan-review";

test("review ownership identifies its plan without adding UI metadata to resume payloads", () => {
  const interrupt = InterruptSchema.parse({
    id: "review",
    reason: "Review",
    metadata: {
      langgraph: {
        raw: {
          kind: "experiment_plan_review",
          workflowCallId: "plan",
          title: "Plan",
          steps: ["Try"],
        },
      },
    },
  });
  const review = parsePlanReview(interrupt);

  assert.deepEqual(review, {
    interruptId: "review",
    workflowCallId: "plan",
    title: "Plan",
    steps: ["Try"],
  });
  assert.ok(review);
  assert.deepEqual(
    reviewEntries([{ ...review, decision: "approve" }], [interrupt]),
    [
      {
        interruptId: "review",
        status: "resolved",
        payload: { decision: "approve", title: "Plan", steps: ["Try"] },
      },
    ],
  );
});
