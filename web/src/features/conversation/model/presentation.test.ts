import { test } from "vitest";
import assert from "node:assert/strict";
import { EventType, HttpAgent, type Message } from "@ag-ui/client";
import { hasMessageText, waitingForAssistantText } from "./presentation";

test("tool events and empty text starts keep the assistant waiting until visible text arrives", async () => {
  const input: Message = {
    id: "question",
    role: "user",
    content: "Add 12 and 30",
  };
  const stages: {
    event: EventType;
    messages: readonly Message[];
    waiting: boolean;
  }[] = [];
  let currentEvent = EventType.RUN_STARTED;
  const events = [
    { type: EventType.RUN_STARTED, threadId: "thread", runId: "run" },
    {
      type: EventType.TOOL_CALL_START,
      toolCallId: "sum",
      toolCallName: "calculate_sum",
      parentMessageId: "tool-request",
    },
    {
      type: EventType.TOOL_CALL_ARGS,
      toolCallId: "sum",
      delta: '{"a":12,"b":30}',
    },
    { type: EventType.TOOL_CALL_END, toolCallId: "sum" },
    {
      type: EventType.TOOL_CALL_RESULT,
      toolCallId: "sum",
      messageId: "sum-result",
      role: "tool",
      content: "42",
    },
    {
      type: EventType.TEXT_MESSAGE_START,
      messageId: "reply",
      role: "assistant",
    },
    { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "reply", delta: " " },
    { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "reply", delta: "42" },
    { type: EventType.TEXT_MESSAGE_END, messageId: "reply" },
    { type: EventType.RUN_FINISHED, threadId: "thread", runId: "run" },
  ];
  const agent = new HttpAgent({
    threadId: "thread",
    url: "/agent",
    initialMessages: [input],
    fetch: () =>
      Promise.resolve(
        new Response(
          events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
          { headers: { "Content-Type": "text/event-stream" } },
        ),
      ),
  });

  agent.subscribe({
    onEvent({ event }) {
      currentEvent = event.type;
    },

    onMessagesChanged({ messages }) {
      stages.push({
        event: currentEvent,
        messages: structuredClone(messages),
        waiting: waitingForAssistantText(messages, true),
      });
    },
  });

  await agent.runAgent({ runId: "run" });

  for (const event of [
    EventType.TOOL_CALL_START,
    EventType.TOOL_CALL_RESULT,
    EventType.TEXT_MESSAGE_START,
  ]) {
    const stage = stages.find((stage) => stage.event === event);

    assert.ok(stage, `Expected a message update for ${event}`);
    assert.equal(
      stage.waiting,
      true,
      `${event} must keep the assistant visible`,
    );
    assert.equal(
      stage.messages.some(
        (message) => message.role === "assistant" && hasMessageText(message),
      ),
      false,
      "Empty assistant messages must not reserve blank message rows",
    );
  }

  const content = stages.filter(
    (stage) => stage.event === EventType.TEXT_MESSAGE_CONTENT,
  );

  assert.equal(content[0]?.waiting, true, "Whitespace is not a visible reply");
  assert.equal(content[1]?.waiting, false, "Text replaces the waiting status");
  assert.equal(waitingForAssistantText(agent.messages, false), false);
  assert.equal(waitingForAssistantText([input], true), true);
  assert.equal(waitingForAssistantText([input], false), false);
});
