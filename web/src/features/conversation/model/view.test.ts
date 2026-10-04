import { test } from "vitest";
import assert from "node:assert/strict";
import { InterruptSchema, type Message } from "@ag-ui/client";
import { createA2UIRuntime, workflowCatalog } from "@/features/a2ui";
import { conversationView } from "./view";

test("generic review cards follow their feedback replies and keep history with the original tool", () => {
  const runtime = createA2UIRuntime();
  const messages: Message[] = [
    { id: "start", role: "user", content: "Review copy" },
    {
      id: "call",
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: "copy",
          type: "function",
          function: { name: "review_copy", arguments: "{}" },
        },
      ],
    },
    { id: "reply-one", role: "assistant", content: "First draft" },
    { id: "feedback", role: "user", content: "Make it shorter" },
    { id: "reply-two", role: "assistant", content: "Shorter draft" },
    { id: "later", role: "user", content: "Another task" },
    { id: "later-reply", role: "assistant", content: "Another answer" },
  ];
  const outputs = ["one", "two"].map((round, index) => ({
    id: `copy-${round}`,
    outputSeq: index + 1,
    toolCallId: "copy",
    workflow: {
      presentation: {
        surfaceId: `copy-${round}`,
        groupId: "copy",
        anchorMessageId: `reply-${round}`,
      },
    },
    messages: [
      {
        version: "v0.9" as const,
        createSurface: {
          surfaceId: `copy-${round}`,
          catalogId: workflowCatalog.id,
        },
      },
      {
        version: "v0.9" as const,
        updateComponents: {
          surfaceId: `copy-${round}`,
          components: [
            {
              id: "root",
              component: "WorkflowText",
              role: "body",
              text: `Draft ${round}`,
            },
          ],
        },
      },
    ],
  }));

  try {
    const result = runtime.ingest(outputs);
    const view = conversationView({
      messages,
      surfaces: result.surfaces,
      runs: [],
      pendingInterrupts: [],
    });

    assert.equal(view.turns[0]?.artifacts.current.length, 0);
    assert.deepEqual(
      view.turns[0]?.artifacts.history.map((surface) => surface.surface.id),
      ["copy-one"],
    );
    assert.deepEqual(
      view.turns[1]?.artifacts.current.map((surface) => surface.surface.id),
      ["copy-two"],
    );
    assert.equal(view.turns[2]?.artifacts.current.length, 0);
  } finally {
    runtime.dispose();
  }
});

test("tool surfaces attach once to their owning turn and orphan surfaces remain visible", () => {
  const runtime = createA2UIRuntime();
  const messages: Message[] = [
    { id: "first", role: "user", content: "Plan" },
    {
      id: "call",
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: "plan",
          type: "function",
          function: { name: "run_experiment_workflow", arguments: "{}" },
        },
      ],
    },
    { id: "second", role: "user", content: "Hello" },
    { id: "reply", role: "assistant", content: "Hello" },
  ];

  try {
    const { surfaces } = runtime.ingest(
      ["plan", "missing"].map((toolCallId, index) => ({
        id: `output-${index}`,
        outputSeq: index + 1,
        toolCallId,
        messages: [
          {
            version: "v0.9",
            createSurface: {
              surfaceId: toolCallId,
              catalogId: workflowCatalog.id,
            },
          },
          {
            version: "v0.9",
            updateComponents: {
              surfaceId: toolCallId,
              components: [
                {
                  id: "root",
                  component: "WorkflowText",
                  role: "title",
                  text: toolCallId,
                },
              ],
            },
          },
        ],
      })),
    );
    const view = conversationView({
      messages,
      surfaces,
      runs: [],
      pendingInterrupts: [],
    });

    assert.equal(view.turns[0]?.hasReply, true);
    assert.deepEqual(
      view.turns[0]?.artifacts.current.map((surface) => surface.toolCallId),
      ["plan"],
    );
    assert.equal(view.turns[1]?.artifacts.current.length, 0);
    assert.deepEqual(
      view.unattachedSurfaces.map((surface) => surface.toolCallId),
      ["missing"],
    );
  } finally {
    runtime.dispose();
  }
});

test("an active turn retains its reply before text arrives and reviews survive missing history", () => {
  const interrupt = InterruptSchema.parse({
    id: "review",
    reason: "Review plan",
    metadata: {
      langgraph: {
        raw: { kind: "experiment_plan_review", title: "Plan", steps: ["Try"] },
      },
    },
  });
  const input = {
    messages: [] as Message[],
    surfaces: [],
    runs: [],
    pendingInterrupts: [interrupt],
  };
  const restored = conversationView(input);

  assert.equal(restored.hasContent, true);
  assert.equal(restored.unattachedReviews[0]?.interruptId, "review");
  const active = conversationView({
    ...input,
    messages: [{ id: "question", role: "user", content: "Plan" }],
    runs: [{ runId: "run", messageId: "question", status: "running" }],
  });

  assert.equal(active.turns[0]?.hasReply, true);
  assert.equal(active.turns[0]?.artifacts.reviews[0]?.interruptId, "review");
  assert.equal(active.unattachedReviews.length, 0);
  assert.equal(
    conversationView({ ...input, pendingInterrupts: [] }).hasContent,
    false,
  );
});

test("partial workflow completion preserves the review batch identity for remaining edits", () => {
  const runtime = createA2UIRuntime();
  const calls = ["first-plan", "second-plan"].map((id) => ({
    id,
    type: "function" as const,
    function: { name: "run_experiment_workflow", arguments: "{}" },
  }));
  const interrupts = calls.map((call) =>
    InterruptSchema.parse({
      id: `review-${call.id}`,
      reason: "Review plan",
      metadata: {
        langgraph: {
          raw: {
            kind: "experiment_plan_review",
            workflowCallId: call.id,
            title: call.id,
            steps: ["Try"],
          },
        },
      },
    }),
  );

  try {
    const result = runtime.ingest([
      {
        id: "reviewed",
        outputSeq: 1,
        toolCallId: "first-plan",
        messages: [
          {
            version: "v0.9",
            createSurface: {
              surfaceId: "experiment-first-plan-reviewed",
              catalogId: workflowCatalog.id,
            },
          },
          {
            version: "v0.9",
            updateComponents: {
              surfaceId: "experiment-first-plan-reviewed",
              components: [
                {
                  id: "root",
                  component: "WorkflowText",
                  role: "title",
                  text: "Approved",
                },
              ],
            },
          },
        ],
      },
    ]);
    const view = conversationView({
      messages: [
        { id: "question", role: "user", content: "Plans" },
        { id: "calls", role: "assistant", content: "", toolCalls: calls },
      ],
      runs: [],
      surfaces: result.surfaces,
      pendingInterrupts: interrupts,
    });

    assert.deepEqual(
      view.turns[0]?.artifacts.reviews.map((review) => review.interruptId),
      ["review-second-plan"],
    );
    assert.equal(
      view.turns[0]?.reviewKey,
      "review-first-plan,review-second-plan",
      "A partial result must not remount the remaining draft editor",
    );
  } finally {
    runtime.dispose();
  }
});
