import { expect, test, vi } from "vitest";
import {
  InterruptSchema,
  RunAgentInputSchema,
} from "../../../../shared/ag-ui-schemas.js";
import type { RunRow } from "../../db/conversation-schema.js";
import { validateReview } from "./review-validation.js";

const interrupt = InterruptSchema.parse({
  id: "approval-1",
  reason: "Approval required",
  metadata: {
    langgraph: {
      raw: {
        action_requests: [
          { name: "run_skill_script", args: { arguments: ["--export"] } },
        ],
        review_configs: [
          {
            action_name: "run_skill_script",
            allowed_decisions: ["approve", "reject"],
          },
        ],
      },
    },
  },
});
const request = RunAgentInputSchema.parse({
  threadId: "thread",
  runId: "resume",
  messages: [],
  state: {},
  tools: [],
  context: [],
  forwardedProps: {},
  resume: [
    {
      interruptId: interrupt.id,
      status: "resolved",
      payload: { decisions: [{ type: "approve" }] },
    },
  ],
});
const run: RunRow = {
  threadId: "thread",
  aguiRunId: "original",
  messageId: "message",
  submitSeq: 1,
  request,
  modelId: null,
  aegraRunId: "upstream",
  status: "interrupted",
  checkpointSynced: true,
  interrupts: [interrupt],
  createdAt: new Date(),
};

test("native tool approvals require no business workflow output", async () => {
  const database = { select: vi.fn() };

  await expect(validateReview(request, run, database)).resolves.toBeUndefined();
  expect(database.select).not.toHaveBeenCalled();
});

test("approval admission rejects stale ids, disallowed decisions and unresolved responses", async () => {
  const database = { select: vi.fn() };

  for (const entry of [
    {
      interruptId: "old",
      status: "resolved",
      payload: { decisions: [{ type: "approve" }] },
    },
    {
      interruptId: interrupt.id,
      status: "resolved",
      payload: { decisions: [{ type: "respond", message: "skip approval" }] },
    },
    {
      interruptId: interrupt.id,
      status: "resolved",
      payload: { decisions: [] },
    },
    {
      interruptId: interrupt.id,
      status: "cancelled",
      payload: { decisions: [{ type: "approve" }] },
    },
  ]) {
    await expect(
      validateReview(
        { ...request, resume: [entry] } as typeof request,
        run,
        database,
      ),
    ).rejects.toThrow();
  }

  await expect(
    validateReview(request, { ...run, status: "completed" }, database),
  ).rejects.toThrow();
  expect(database.select).not.toHaveBeenCalled();
});
