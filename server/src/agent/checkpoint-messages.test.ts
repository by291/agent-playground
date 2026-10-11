import { test } from "vitest";
import assert from "node:assert/strict";
import { completedMessages } from "./checkpoint-messages.js";

test("checkpoint recovery preserves provider reasoning separately from answer text", () => {
  const values = {
    response_messages: [
      {
        id: "answer",
        type: "ai",
        content: "Use approach A.",
        additional_kwargs: { reasoning_content: "Compare A and B." },
      },
      {
        id: "blocks",
        type: "ai",
        content: [
          { type: "reasoning", reasoning: "Check the constraints." },
          { type: "text", text: "Both fit." },
        ],
      },
      {
        id: "thinking",
        type: "ai",
        content: [
          { type: "thinking", thinking: "One path is shorter." },
          { type: "redacted_thinking", data: "encrypted" },
        ],
      },
      {
        id: "summary",
        type: "ai",
        content: "Internal summary",
        additional_kwargs: {
          lc_source: "summarization",
          reasoning_content: "Not a reply",
        },
      },
    ],
  };

  assert.deepEqual(completedMessages(values), [
    { id: "answer-reasoning", role: "reasoning", content: "Compare A and B." },
    { id: "answer", role: "assistant", content: "Use approach A." },
    {
      id: "blocks-reasoning",
      role: "reasoning",
      content: "Check the constraints.",
    },
    { id: "blocks", role: "assistant", content: "Both fit." },
    {
      id: "thinking-reasoning",
      role: "reasoning",
      content: "One path is shorter.",
    },
  ]);
});

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
