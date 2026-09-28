import { test } from "vitest";
import assert from "node:assert/strict";
import type { Message } from "@ag-ui/client";
import { chatTurns, toolProcess } from "./turns";

const messages: Message[] = [
  { id: "question", role: "user", content: "What time is it?" },
  {
    id: "note",
    role: "assistant",
    content: "I'll check.",
    toolCalls: [
      {
        id: "clock",
        type: "function",
        function: { name: "get_current_time", arguments: "{}" },
      },
      {
        id: "sum",
        type: "function",
        function: { name: "calculate_sum", arguments: '{"a":1,"b":2}' },
      },
    ],
  },
  { id: "sum-result", role: "tool", toolCallId: "sum", content: "3" },
  {
    id: "clock-result",
    role: "tool",
    toolCallId: "clock",
    content: "12:00 UTC",
  },
  { id: "answer", role: "assistant", content: "It is noon." },
];

test("a user turn owns one reply with parallel tools matched by call ID", () => {
  const turns = chatTurns(messages, [
    { runId: "run", messageId: "question", status: "completed" },
  ]);

  assert.equal(turns.length, 1);
  const process = toolProcess(turns[0]!);

  assert.equal(process[0]?.message.content, "I'll check.");
  assert.deepEqual(
    process[0]?.calls.map((call) => [call.result?.content, call.status]),
    [
      ["12:00 UTC", "completed"],
      ["3", "completed"],
    ],
  );
});

test("tool argument completion is not execution completion", () => {
  const turn = chatTurns(messages.slice(0, 2), [
    { runId: "run", messageId: "question", status: "running" },
  ])[0]!;

  assert.equal(toolProcess(turn)[0]?.calls[0]?.status, "running");
});

test("review resumes stay in the same reply and a new question starts another", () => {
  const turns = chatTurns(
    [...messages, { id: "next", role: "user", content: "Hello" }],
    [
      { runId: "run", messageId: "question", status: "interrupted" },
      { runId: "resume", messageId: "resume", status: "failed" },
      { runId: "next-run", messageId: "next", status: "running" },
    ],
  );

  assert.equal(turns.length, 2);
  assert.equal(turns[0]?.status, "failed");
  assert.equal(turns[1]?.status, "running");
});

test("failed results and unfinished interrupted calls retain distinct statuses", () => {
  const failed = {
    id: "failed",
    role: "tool" as const,
    toolCallId: "sum",
    content: "Service unavailable",
    error: "Service unavailable",
  };
  const turn = chatTurns(
    [...messages.slice(0, 2), failed],
    [{ runId: "run", messageId: "question", status: "interrupted" }],
  )[0]!;

  assert.deepEqual(
    toolProcess(turn)[0]?.calls.map((call) => call.status),
    ["paused", "failed"],
  );
});
