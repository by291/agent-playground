import { test } from "vitest";
import assert from "node:assert/strict";
import { InterruptSchema } from "@shared/ag-ui-schemas";
import { type Message } from "@ag-ui/client";
import {
  createA2UIRuntime,
  workflowCatalog,
  type A2UIOutput,
} from "@/features/a2ui/index";
import type { ExternalTaskSnapshot } from "@shared/external-task";
import { conversationView } from "./conversation-view";

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

const revisedProposal =
  "# Revised proposal\n\n**Recommendation:** compare paid orders.";
const a2aMessages: Message[] = [
  { id: "a2a-question", role: "user", content: "Analyze orders" },
  {
    id: "a2a-call",
    role: "assistant",
    content: "",
    toolCalls: [
      {
        id: "collaboration",
        type: "function",
        function: { name: "run_a2a_workflow", arguments: "{}" },
      },
    ],
  },
];
const completedA2aTask: ExternalTaskSnapshot = {
  taskId: "a2a-job",
  workflowCallId: "collaboration",
  label: "A2A collaboration",
  kind: "a2a",
  revision: 4,
  status: "succeeded",
  stage: "done",
  message: "Complete",
  history: [],
  continuationStatus: "completed",
  outputs: [
    {
      agent: "Planner",
      step: "revise",
      taskId: "revision",
      contextId: "planner-context",
      status: "succeeded",
      text: `${revisedProposal}\n`,
    },
  ],
};

function a2aResultOutput(
  text: string,
  surfaceId = "a2a-collaboration-result",
  outputSeq = 1,
): A2UIOutput {
  const lines = text.split(/\r?\n/);
  const stepIds = lines.map((_, index) => `step-${index}`);

  return {
    id: `output-${outputSeq}`,
    outputSeq,
    toolCallId: "collaboration",
    workflow: { presentation: { surfaceId, groupId: "collaboration" } },
    messages: [
      {
        version: "v0.9",
        createSurface: { surfaceId, catalogId: workflowCatalog.id },
      },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId,
          components: [
            {
              id: "root",
              component: "WorkflowPanel",
              children: ["eyebrow", "title", "steps"],
            },
            {
              id: "eyebrow",
              component: "WorkflowText",
              role: "eyebrow",
              text: "A2A COLLABORATION",
            },
            {
              id: "title",
              component: "WorkflowText",
              role: "title",
              text: "Reviewed and revised proposal",
            },
            { id: "steps", component: "WorkflowSteps", children: stepIds },
            ...lines.map((line, index) => ({
              id: stepIds[index]!,
              component: "WorkflowText",
              role: "step",
              text: line,
            })),
          ],
        },
      },
    ],
  };
}

test("legacy A2A result text is hidden only in composition and keeps presentation history ownership", () => {
  const runtime = createA2UIRuntime();
  const outputs = [
    a2aResultOutput("Planning completed", "a2a-collaboration-plan"),
    a2aResultOutput(
      revisedProposal.replaceAll("\n", "\r\n"),
      "a2a-collaboration-result",
      2,
    ),
  ];

  try {
    const state = runtime.ingest(outputs);
    const input = {
      messages: a2aMessages,
      runs: [],
      surfaces: state.surfaces,
      pendingInterrupts: [],
      externalTasks: [completedA2aTask],
    };
    const view = conversationView(input);

    assert.equal(view.turns[0]?.artifacts.current.length, 0);
    assert.deepEqual(
      view.turns[0]?.artifacts.history.map((surface) => surface.surface.id),
      ["a2a-collaboration-plan"],
    );
    assert.equal(view.turns[0]?.externalTasks[0], completedA2aTask);
    assert.equal(runtime.ingest(outputs).surfaces.length, 2);
    assert.equal(
      conversationView({ ...input, messages: [] }).unattachedSurfaces.length,
      0,
    );
    const withoutChildOutput = conversationView({
      ...input,
      externalTasks: [{ ...completedA2aTask, outputs: undefined }],
    });

    assert.equal(
      withoutChildOutput.turns[0]?.artifacts.current[0]?.surface.id,
      "a2a-collaboration-result",
    );
  } finally {
    runtime.dispose();
  }
});

test.each([
  {
    name: "compact receipt",
    text: "The revised proposal is shown in the agent output above.",
    task: completedA2aTask,
  },
  {
    name: "missing child output",
    text: revisedProposal,
    task: { ...completedA2aTask, outputs: undefined },
  },
  {
    name: "empty child output",
    text: revisedProposal,
    task: {
      ...completedA2aTask,
      outputs: [{ ...completedA2aTask.outputs![0]!, text: "" }],
    },
  },
  {
    name: "another workflow owner",
    text: revisedProposal,
    task: { ...completedA2aTask, workflowCallId: "other-call" },
  },
  {
    name: "unrelated workflow kind",
    text: revisedProposal,
    task: { ...completedA2aTask, kind: undefined },
  },
  {
    name: "unrelated surface",
    text: revisedProposal,
    surfaceId: "orders-chart",
    task: completedA2aTask,
  },
  {
    name: "distinct result text",
    text: "An independent conclusion",
    task: completedA2aTask,
  },
])("A2A composition retains $name", ({ text, task, surfaceId }) => {
  const runtime = createA2UIRuntime();

  try {
    const state = runtime.ingest([a2aResultOutput(text, surfaceId)]);
    const view = conversationView({
      messages: a2aMessages,
      runs: [],
      surfaces: state.surfaces,
      pendingInterrupts: [],
      externalTasks: [task],
    });

    assert.equal(view.turns[0]?.artifacts.current.length, 1);
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
