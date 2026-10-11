import { test } from "vitest";
import assert from "node:assert/strict";
import {
  externalTaskSnapshotSchema,
  externalTaskUpdateSchema,
  isExternalTaskTerminal,
} from "../../../../shared/external-task.js";

test("child output survives input-required and cancellation snapshots", () => {
  const parsed = externalTaskUpdateSchema.safeParse({
    revision: 2,
    kind: "a2a",
    status: "input_required",
    stage: "plan",
    message: "Which audience should the plan address?",
    outputs: [
      {
        agent: "Planner",
        step: "plan",
        taskId: "remote-1",
        contextId: "context-1",
        status: "input_required",
        text: "Draft",
      },
    ],
  });

  assert.equal(parsed.success, true);
  assert.equal(isExternalTaskTerminal("cancelled"), true);
  assert.equal(isExternalTaskTerminal("input_required"), false);
});

test("child output limits reject oversized updates and public snapshots retain outputs", () => {
  const output = {
    agent: "Planner",
    step: "plan",
    taskId: "remote-1",
    contextId: "context-1",
    status: "running",
    text: "Draft",
  };
  const update = {
    revision: 1,
    kind: "a2a",
    status: "running",
    stage: "plan",
    message: "Planning",
    outputs: [output],
  };

  assert.equal(externalTaskUpdateSchema.safeParse(update).success, true);
  assert.equal(
    externalTaskUpdateSchema.safeParse({
      ...update,
      outputs: Array.from({ length: 7 }, () => output),
    }).success,
    false,
  );
  assert.equal(
    externalTaskUpdateSchema.safeParse({
      ...update,
      outputs: [{ ...output, text: "x".repeat(100001) }],
    }).success,
    false,
  );
  const snapshot = externalTaskSnapshotSchema.parse({
    ...update,
    taskId: "job-1",
    workflowCallId: "call-1",
    label: "Collaboration",
    history: [],
    continuationStatus: null,
  });

  assert.equal(snapshot.kind, "a2a");
  assert.equal(snapshot.outputs?.[0]?.text, "Draft");
});
