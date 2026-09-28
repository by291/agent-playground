import assert from "node:assert/strict";
import test from "node:test";
import type { ToolCall } from "@ag-ui/client";
import type { A2uiMessage } from "@a2ui/web_core/v0_9";
import { workflowCatalog } from "@/features/a2ui";
import { createA2UIRuntime } from "@/features/a2ui";
import { workflowArtifacts } from "./workflowArtifacts";

const calls: ToolCall[] = [
  {
    id: "plan",
    type: "function",
    function: { name: "run_experiment_workflow", arguments: "{}" },
  },
  {
    id: "second",
    type: "function",
    function: { name: "run_experiment_workflow", arguments: "{}" },
  },
];

function output(sequence: number, callId: string, stage: string) {
  const surfaceId = `experiment-${callId}-${stage}`;
  const messages: A2uiMessage[] = [
    {
      version: "v0.9",
      createSurface: { surfaceId, catalogId: workflowCatalog.id },
    },
    {
      version: "v0.9",
      updateComponents: {
        surfaceId,
        components: [
          { id: "root", component: "WorkflowText", role: "title", text: stage },
        ],
      },
    },
  ];

  return {
    id: `output-${sequence}`,
    outputSeq: sequence,
    toolCallId: callId,
    messages,
  };
}

void test("workflow stages share one current card and preserve earlier cards as history", () => {
  const runtime = createA2UIRuntime();
  const outputs = [
    output(1, "plan", "idea"),
    output(2, "plan", "draft"),
    output(3, "plan", "reviewed"),
  ];

  try {
    const state = runtime.ingest(outputs);
    const artifacts = workflowArtifacts(calls, state.surfaces, []);

    assert.deepEqual(
      artifacts.current.map((view) => view.surface.id),
      ["experiment-plan-reviewed"],
    );
    assert.deepEqual(
      artifacts.history.map((view) => view.surface.id),
      ["experiment-plan-idea", "experiment-plan-draft"],
    );
    const restored = workflowArtifacts(
      calls,
      runtime.ingest(outputs).surfaces,
      [],
    );

    assert.deepEqual(
      restored.current.map((view) => view.surface.id),
      ["experiment-plan-reviewed"],
    );
  } finally {
    runtime.dispose();
  }
});

void test("review edits replace the review prompt and disappear when their result arrives", () => {
  const runtime = createA2UIRuntime();
  const review = {
    interruptId: "review",
    workflowCallId: "plan",
    title: "Plan",
    steps: ["Try"],
  };

  try {
    const waiting = runtime.ingest([output(1, "plan", "review")]);
    const editable = workflowArtifacts(calls, waiting.surfaces, [review]);

    assert.equal(editable.current.length, 0);
    assert.deepEqual(editable.reviews, [review]);
    assert.deepEqual(
      editable.history.map((view) => view.surface.id),
      ["experiment-plan-review"],
    );
    const completed = runtime.ingest([output(2, "plan", "reviewed")]);
    const approved = workflowArtifacts(calls, completed.surfaces, [review]);

    assert.equal(approved.reviews.length, 0);
    assert.deepEqual(
      approved.current.map((view) => view.surface.id),
      ["experiment-plan-reviewed"],
    );
  } finally {
    runtime.dispose();
  }
});

void test("parallel workflow cards and unrelated surfaces remain independently visible", () => {
  const runtime = createA2UIRuntime();

  try {
    const state = runtime.ingest([
      output(1, "plan", "draft"),
      output(2, "second", "draft"),
      output(3, "plan", "reviewed"),
      output(4, "plan", "chart"),
    ]);
    const artifacts = workflowArtifacts(calls, state.surfaces, []);

    assert.deepEqual(
      artifacts.current.map((view) => view.surface.id),
      [
        "experiment-plan-reviewed",
        "experiment-second-draft",
        "experiment-plan-chart",
      ],
    );
    assert.deepEqual(
      artifacts.history.map((view) => view.surface.id),
      ["experiment-plan-draft"],
    );
  } finally {
    runtime.dispose();
  }
});
