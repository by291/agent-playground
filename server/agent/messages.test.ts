import { test } from "vitest";
import assert from "node:assert/strict";
import { completedMessages } from "./messages";

test("checkpoint replies preserve tool calls, empty assistant messages and failed results", () => {
  const messages = completedMessages({
    messages: [],
    response_messages: [
      {
        id: "note",
        type: "ai",
        content: "I'll check.",
        tool_calls: [{ id: "clock", name: "get_current_time", args: {} }],
      },
      {
        id: "result",
        type: "tool",
        content: "Clock unavailable",
        tool_call_id: "clock",
        status: "error",
      },
      {
        id: "retry",
        type: "ai",
        content: "",
        tool_calls: [
          {
            id: "retry-clock",
            name: "get_current_time",
            args: { timezone: "UTC" },
          },
        ],
      },
      {
        id: "answer",
        type: "ai",
        content: [
          { type: "text", text: "Sorry, try later." },
          { type: "reasoning", text: "Private thoughts" },
        ],
      },
    ],
  });

  assert.equal(messages.length, 4);
  assert.deepEqual(messages[0], {
    id: "note",
    role: "assistant",
    content: "I'll check.",
    toolCalls: [
      {
        id: "clock",
        type: "function",
        function: { name: "get_current_time", arguments: "{}" },
      },
    ],
  });
  assert.deepEqual(messages[1], {
    id: "result",
    role: "tool",
    content: "Clock unavailable",
    toolCallId: "clock",
    error: "Clock unavailable",
  });
  assert.equal(messages[2]?.content, "");
  assert.equal(messages[3]?.content, "Sorry, try later.");
});

test("checkpoint recovery includes results from older AI-only response archives", () => {
  const call = {
    id: "request",
    type: "ai",
    content: "Checking",
    tool_calls: [{ id: "lookup", name: "lookup", args: {} }],
  };
  const answer = { id: "answer", type: "ai", content: "Found" };
  const result = {
    id: "result",
    type: "tool",
    tool_call_id: "lookup",
    content: "Raw result",
  };
  const messages = completedMessages({
    messages: [call, result, answer],
    response_messages: [call, answer],
  });

  assert.deepEqual(
    messages.map((message) => message.id),
    ["request", "result", "answer"],
  );
});
