import { test } from "vitest";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AssistantReply } from "./AssistantReply";
import { chatTurns, type ChatTurn } from "../../model/turns";
import type { Message } from "@ag-ui/client";

function planningTurn(
  updates: { arguments: string; committed?: boolean; error?: string }[],
  status: ChatTurn["status"] = "running",
): ChatTurn {
  const messages: Message[] = [];

  for (const [index, update] of updates.entries()) {
    const id = `plan-${index}`;

    messages.push({
      id: `assistant-${index}`,
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id,
          type: "function",
          function: { name: "write_todos", arguments: update.arguments },
        },
      ],
    });

    if (update.committed) {
      messages.push({
        id: `result-${index}`,
        role: "tool",
        toolCallId: id,
        content: "Plan updated",
        ...(update.error ? { error: update.error } : {}),
      });
    }
  }

  return { id: "planning", user: null, messages, status };
}

function renderPlan(turn: ChatTurn) {
  return renderToStaticMarkup(
    createElement(AssistantReply, { turn, animatedMessageId: null }),
  );
}

test("the latest committed plan replaces earlier steps and shows actual completion progress", () => {
  const markup = renderPlan(
    planningTurn([
      {
        committed: true,
        arguments: JSON.stringify({
          todos: [{ content: "Original approach", status: "in_progress" }],
        }),
      },
      {
        committed: true,
        arguments: JSON.stringify({
          todos: [
            { content: "Inspect the sources", status: "completed" },
            { content: "Compare the evidence", status: "in_progress" },
            { content: "Write the report", status: "pending" },
          ],
        }),
      },
    ]),
  );

  assert.match(markup, /aria-label="Agent plan"/);
  assert.match(markup, /1 of 3 completed/);
  assert.match(markup, /Inspect the sources/);
  assert.match(markup, /Compare the evidence/);
  assert.match(markup, /Write the report/);
  assert.doesNotMatch(markup, /Original approach/);
});

test("partial and failed updates do not replace the last executed plan", () => {
  const initial = {
    committed: true,
    arguments: JSON.stringify({
      todos: [{ content: "Keep the verified plan", status: "in_progress" }],
    }),
  };
  const updates = [
    { arguments: '{"todos":[' },
    {
      committed: true,
      arguments: '{"todos":[{"content":"Invalid","status":"unknown"}]}',
    },
    {
      committed: true,
      error: "Plan rejected",
      arguments: JSON.stringify({
        todos: [{ content: "Rejected replacement", status: "completed" }],
      }),
    },
  ];

  for (const update of updates) {
    const markup = renderPlan(planningTurn([initial, update]));

    assert.match(markup, /Keep the verified plan/);
    assert.match(markup, /0 of 1 completed/);
    assert.doesNotMatch(markup, /Rejected replacement/);
  }
});

test("a successful empty update clears the visible plan", () => {
  const markup = renderPlan(
    planningTurn([
      {
        committed: true,
        arguments:
          '{"todos":[{"content":"Previous task","status":"in_progress"}]}',
      },
      { committed: true, arguments: '{"todos":[]}' },
    ]),
  );

  assert.doesNotMatch(markup, /aria-label="Agent plan"/);
  assert.doesNotMatch(markup, /Previous task/);
});

test("a finished run keeps unfinished plan steps honest", () => {
  const markup = renderPlan(
    planningTurn(
      [
        {
          committed: true,
          arguments:
            '{"todos":[{"content":"Unfinished investigation","status":"in_progress"}]}',
        },
      ],
      "completed",
    ),
  );

  assert.match(markup, /Unfinished investigation/);
  assert.match(markup, /0 of 1 completed/);
  assert.match(markup, /Not completed/);
});

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
  assert.match(markup, /Completed/);
  assert.match(markup, /data-streamdown="strong"/);
  assert.doesNotMatch(markup, /I'll check that for you/);
  assert.match(markup, /get_current_time/);
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

  assert.match(failure, /Failed/);
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

test("external waits are described as background work instead of user review", () => {
  const turn = chatTurns(
    [
      { id: "question", role: "user", content: "Build a report" },
      {
        id: "call",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "report-call",
            type: "function",
            function: { name: "run_report_workflow", arguments: "{}" },
          },
        ],
      },
    ],
    [{ runId: "run", messageId: "question", status: "interrupted" }],
  )[0]!;
  const markup = renderToStaticMarkup(
    createElement(AssistantReply, {
      turn,
      animatedMessageId: null,
      externalWaitCallIds: ["report-call"],
    }),
  );

  assert.match(markup, /Waiting for external task/);
  assert.doesNotMatch(markup, /Waiting for your review/);
});

test("clarification is an ordered dialogue with a confirmed user bubble instead of a tool row", () => {
  const turn: ChatTurn = {
    id: "clarification",
    user: null,
    status: "completed",
    messages: [
      {
        id: "ask",
        role: "assistant",
        content: "I have a preference question.",
        toolCalls: [
          {
            id: "clarify",
            type: "function",
            function: {
              name: "ask_user",
              arguments: JSON.stringify({
                questions: [
                  { id: "style", question: "How detailed should I be?" },
                ],
              }),
            },
          },
        ],
      },
      {
        id: "answer",
        role: "tool",
        toolCallId: "clarify",
        content: JSON.stringify({
          answers: [{ id: "style", answer: "Concise and direct" }],
        }),
      },
      { id: "final", role: "assistant", content: "I will keep it concise." },
    ],
  };
  const markup = renderPlan(turn);

  assert.doesNotMatch(
    markup,
    /ask_user|Waiting for your review|Parameters|aria-label="Tool /,
  );
  assert.match(markup, /aria-label="Agent question"/);
  assert.match(markup, /aria-label="Your clarification response"/);
  assert.ok(
    markup.indexOf("I have a preference question.") <
      markup.indexOf("How detailed should I be?"),
  );
  assert.ok(
    markup.indexOf("How detailed should I be?") <
      markup.indexOf("Concise and direct"),
  );
  assert.ok(
    markup.indexOf("Concise and direct") <
      markup.indexOf("I will keep it concise."),
  );

  const pending = renderPlan({
    ...turn,
    messages: turn.messages.slice(0, 1),
    status: "interrupted",
  });

  assert.match(pending, /Waiting for your answer/);
  assert.doesNotMatch(
    pending,
    /Your clarification response|ask_user|aria-label="Tool /,
  );
});
