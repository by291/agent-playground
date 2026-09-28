import { test } from "vitest";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AssistantReply } from "./AssistantReply";
import { chatTurns, type ChatTurn } from "../../model/turns";

test("a tool reply uses one avatar, keeps commentary collapsed and renders the final Markdown", () => {
  const turn = chatTurns(
    [
      { id: "question", role: "user", content: "Time?" },
      {
        id: "note",
        role: "assistant",
        content: "I'll check that for you.",
        toolCalls: [
          {
            id: "clock",
            type: "function",
            function: { name: "get_current_time", arguments: "{}" },
          },
        ],
      },
      { id: "result", role: "tool", toolCallId: "clock", content: "12:00 UTC" },
      { id: "final", role: "assistant", content: "It is **12:00 UTC**." },
    ],
    [{ runId: "run", messageId: "question", status: "completed" }],
  )[0]!;
  const markup = renderToStaticMarkup(
    createElement(AssistantReply, { turn, animatedMessageId: null }),
  );

  assert.equal((markup.match(/data-slot="message-avatar"/g) ?? []).length, 1);
  assert.match(markup, /aria-expanded="false"/);
  assert.match(markup, /Used 1 tool/);
  assert.match(markup, /data-streamdown="strong"/);
  assert.doesNotMatch(markup, /I'll check that for you/);
  assert.doesNotMatch(markup, /get_current_time/);
});

test("tool-only waiting and failures retain their reply while cards remain outside the fold", () => {
  const turn = chatTurns(
    [
      { id: "question", role: "user", content: "Build a plan" },
      {
        id: "note",
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
    ],
    [{ runId: "run", messageId: "question", status: "interrupted" }],
  )[0]!;
  const markup = renderToStaticMarkup(
    createElement(
      AssistantReply,
      { turn, animatedMessageId: null },
      createElement("div", null, "Plan card"),
    ),
  );

  assert.match(markup, /Waiting for your review/);
  assert.match(markup, /Plan card/);
  assert.equal((markup.match(/data-slot="message-avatar"/g) ?? []).length, 1);
  turn.status = "failed";
  const failure = renderToStaticMarkup(
    createElement(AssistantReply, { turn, animatedMessageId: null }),
  );

  assert.match(failure, /Tool process failed/);
  assert.match(failure, /aria-expanded="false"/);
});

test("completed replies release streaming controls for the latest streamed message", () => {
  const turn: ChatTurn = {
    id: "question",
    user: { id: "question", role: "user", content: "Compare seasons" },
    messages: [
      {
        id: "reply",
        role: "assistant",
        content: "| Season | Weather |\n| --- | --- |\n| Spring | Mild |",
      },
    ],
    status: "running",
  };
  const completed = renderToStaticMarkup(
    createElement(AssistantReply, {
      turn: { ...turn, status: "completed" },
      animatedMessageId: "reply",
    }),
  );
  const completedCopy = /<button[^>]*title="Copy table"[^>]*>/.exec(
    completed,
  )?.[0];

  assert.ok(completedCopy);
  assert.doesNotMatch(completedCopy, /disabled=""/);
});
