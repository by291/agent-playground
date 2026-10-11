import assert from "node:assert/strict";
import { test } from "vitest";
import { z } from "zod";
import {
  MessageSchema,
  RunAgentInputSchema,
  InterruptSchema,
} from "../../../shared/ag-ui-schemas.js";

test("official protocol validators compose with application contracts and preserve structured tool results", () => {
  const content = [
    { type: "text", text: "result" },
    {
      type: "image",
      source: { type: "url", value: "https://example.com/result.png" },
    },
  ];
  const schema = z.object({
    messages: MessageSchema.array(),
    interrupts: InterruptSchema.array(),
    input: RunAgentInputSchema,
  });
  const message = {
    id: "tool-result",
    role: "tool",
    toolCallId: "call",
    content,
  };
  const input = {
    threadId: "thread",
    runId: "run",
    messages: [message],
    state: {},
    tools: [],
    context: [],
    forwardedProps: {},
    resume: [
      { interruptId: "review", status: "resolved", value: { approved: true } },
    ],
  };
  const parsed = schema.parse({
    messages: [message],
    interrupts: [{ id: "review", reason: "review" }],
    input,
  });

  assert.deepEqual(parsed.messages[0]?.content, content);
  assert.deepEqual(parsed.input.resume, input.resume);
  assert.equal(
    schema.safeParse({
      messages: [{ ...message, content: [{ type: "unknown" }] }],
      interrupts: [],
      input,
    }).success,
    false,
  );
  assert.equal(
    RunAgentInputSchema.safeParse({
      ...input,
      messages: [{ id: "bad", role: "tool", content: "missing caller" }],
    }).success,
    false,
  );
});
