import { describe, expect, test } from "vitest";
import type { Message } from "@ag-ui/client";
import { clarificationReply } from "./clarification-reply";
import { toolProcess, type ChatTurn } from "./turns";

const questions = [
  { id: "style", question: "How detailed should the answer be?" },
  { id: "tone", question: "Which tone should I use?" },
];

function ask(id: string, args = JSON.stringify({ questions })): Message {
  return {
    id: `ask-${id}`,
    role: "assistant",
    content: "Please choose your preferences.",
    toolCalls: [
      { id, type: "function", function: { name: "ask_user", arguments: args } },
    ],
  };
}

function result(id: string, content: string, error?: string): Message {
  return {
    id: `result-${id}`,
    role: "tool",
    toolCallId: id,
    content,
    ...(error ? { error } : {}),
  };
}

function turn(
  messages: Message[],
  status: ChatTurn["status"] = "completed",
): ChatTurn {
  return { id: "turn", user: null, messages, status };
}

const answers = JSON.stringify({
  answers: [
    { id: "style", answer: "Concise" },
    { id: "tone", answer: "Friendly" },
  ],
});

describe("clarification reply projection", () => {
  test("keeps commentary, questions, confirmed user answers and continuation in order", () => {
    const parts = clarificationReply(
      turn([
        ask("first"),
        result("first", answers),
        {
          id: "continue",
          role: "assistant",
          content: "I will use those preferences.",
        },
        ask("second"),
        result("second", answers),
        { id: "final", role: "assistant", content: "Ready." },
      ]),
    );

    expect(parts?.map((part) => part.type)).toEqual([
      "assistant",
      "answer",
      "assistant",
      "answer",
      "assistant",
    ]);
    expect(parts?.[0]).toMatchObject({
      clarification: { id: "first", questions, status: "answered" },
    });
    expect(parts?.[1]).toMatchObject({
      messageId: "result-first",
      answers: [
        { question: questions[0]!.question, answer: "Concise" },
        { question: questions[1]!.question, answer: "Friendly" },
      ],
    });
    expect(parts?.[2]).toMatchObject({
      turn: {
        messages: [
          { id: "continue", content: "I will use those preferences." },
          { id: "ask-second", content: "Please choose your preferences." },
        ],
      },
    });
    expect(
      parts
        ?.flatMap((part) =>
          part.type === "assistant" ? part.turn.messages : [],
        )
        .some(
          (message) =>
            message.role === "tool" ||
            (message.role === "assistant" &&
              message.toolCalls?.some(
                (call) => call.function.name === "ask_user",
              )),
        ),
    ).toBe(false);
  });

  test("shows pending questions before a result without inventing a user message", () => {
    expect(
      clarificationReply(turn([ask("pending")], "interrupted")),
    ).toMatchObject([
      { type: "assistant", clarification: { questions, status: "waiting" } },
    ]);
  });

  test.each([
    [
      "out of order",
      JSON.stringify({
        answers: [
          { id: "tone", answer: "Friendly" },
          { id: "style", answer: "Concise" },
        ],
      }),
    ],
    [
      "missing answer",
      JSON.stringify({ answers: [{ id: "style", answer: "Concise" }] }),
    ],
    [
      "blank answer",
      JSON.stringify({
        answers: [
          { id: "style", answer: " " },
          { id: "tone", answer: "Friendly" },
        ],
      }),
    ],
    ["raw result", "Unstructured response"],
  ])(
    "does not promote %s into a confirmed user response",
    (_label, content) => {
      const parts = clarificationReply(
        turn([ask("invalid"), result("invalid", content)]),
      );

      expect(parts).toHaveLength(1);
      expect(parts?.[0]).toMatchObject({
        clarification: { status: "unavailable" },
      });
    },
  );

  test("distinguishes skipped and failed calls without displaying raw tool output", () => {
    const rejected =
      "User rejected the tool call for `ask_user` with id declined. The tool was not executed. Do not retry this tool call unless the user explicitly requests it.";

    expect(
      clarificationReply(
        turn([ask("declined"), result("declined", rejected, rejected)]),
      )?.[0],
    ).toMatchObject({ clarification: { status: "skipped" } });
    expect(
      clarificationReply(
        turn([ask("failed"), result("failed", answers, "Provider failed")]),
      )?.[0],
    ).toMatchObject({ clarification: { status: "failed" } });
  });

  test("partial arguments stay legible and ordinary tools in a mixed call remain intact", () => {
    const mixed = ask("partial", '{"questions":[');

    if (mixed.role !== "assistant") {
      throw new Error("Expected assistant fixture");
    }

    mixed.toolCalls!.push({
      id: "clock",
      type: "function",
      function: { name: "get_current_time", arguments: "{}" },
    });
    const parts = clarificationReply(turn([mixed], "running"));

    expect(parts?.[0]).toMatchObject({
      clarification: { questions: [], status: "preparing" },
    });
    expect(
      parts?.[0]?.type === "assistant" &&
        parts[0].turn.messages.some(
          (message) =>
            message.role === "assistant" &&
            message.toolCalls?.some((call) => call.id === "clock"),
        ),
    ).toBe(true);
  });

  test("replayed result identity produces one answer bubble and ordinary turns use the existing renderer", () => {
    const confirmed = result("replayed", answers);
    const restored = turn([ask("replayed"), confirmed, confirmed]);

    expect(
      clarificationReply(restored)?.filter((part) => part.type === "answer"),
    ).toHaveLength(1);
    expect(
      clarificationReply(
        turn([{ id: "plain", role: "assistant", content: "Hello" }]),
      ),
    ).toBeNull();
  });

  test.each([undefined, "Clock failed"])(
    "ordinary tool results remain available across a clarification boundary (error: %s)",
    (error) => {
      const mixed = ask("question");

      if (mixed.role !== "assistant") {
        throw new Error("Expected assistant fixture");
      }

      mixed.toolCalls!.push({
        id: "clock",
        type: "function",
        function: { name: "get_current_time", arguments: "{}" },
      });
      const original = turn([
        mixed,
        result("clock", "12:00", error),
        result("question", answers),
      ]);
      const part = clarificationReply(original)?.[0];

      expect(part?.type).toBe("assistant");

      if (part?.type === "assistant") {
        const process = toolProcess(part.turn, [], original.messages);

        expect(process[0]?.calls[0]).toMatchObject({
          status: error ? "failed" : "completed",
          result: { content: "12:00", ...(error ? { error } : {}) },
        });
      }
    },
  );

  test("ambiguous repeated call IDs cannot create a user answer", () => {
    const parts = clarificationReply(
      turn([ask("duplicate"), ask("duplicate"), result("duplicate", answers)]),
    );

    expect(parts?.some((part) => part.type === "answer")).toBe(false);
  });
});
