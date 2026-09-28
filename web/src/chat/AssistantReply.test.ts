import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AssistantReply } from "./AssistantReply";
import { chatTurns } from "./turns";

void test("a tool reply uses one avatar, keeps commentary collapsed and renders the final Markdown", () => {
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

void test("tool-only waiting and failures retain their reply while cards remain outside the fold", () => {
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
