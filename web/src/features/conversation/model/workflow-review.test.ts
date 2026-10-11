import { expect, test } from "vitest";
import { InterruptSchema } from "@shared/ag-ui-schemas";
import { parseWorkflowReview, reviewResponse } from "@shared/workflow-review";
import { workflowReplyMessages } from "@shared/workflow-output";

test("a copy review supports discussion and blocks acceptance without any SQL fields", () => {
  const interrupt = InterruptSchema.parse({
    id: "copy-review",
    reason: "Review copy",
    metadata: {
      langgraph: {
        raw: {
          kind: "workflow_review",
          workflowCallId: "copy-call",
          revision: 4,
          round: 2,
          outputStepId: "review:2",
          canAccept: false,
          title: "Copy decision",
          acceptLabel: "Accept copy",
          messagePlaceholder: "Discuss this copy…",
          blockedReason: "Resolve the factual issue first.",
        },
      },
    },
  });
  const review = parseWorkflowReview(interrupt);

  expect(review).not.toBeNull();
  expect(reviewResponse(review!, "accept")).toBeNull();
  expect(
    reviewResponse(review!, "message", { id: "feedback", content: "Explain" })
      ?.payload,
  ).toMatchObject({ action: "message", round: 2, revision: 4 });
});

test("assistant replies come from output metadata without inspecting business cards", () => {
  const output = {
    messages: [],
    workflow: {
      reply: { id: "copy-reply", content: "The wording is clearer now." },
    },
  };

  expect(workflowReplyMessages(output)).toEqual([
    {
      id: "copy-reply",
      role: "assistant",
      content: "The wording is clearer now.",
    },
  ]);
});
