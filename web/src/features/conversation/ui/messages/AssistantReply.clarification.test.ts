// @vitest-environment jsdom
import { createElement } from "react";
import { fireEvent, render } from "@testing-library/react";
import { expect, test } from "vitest";
import type { Message, ToolCall } from "@ag-ui/client";
import type { ChatTurn } from "../../model/turns";
import { AssistantReply } from "./AssistantReply";

function ask(id: string): Message {
  return {
    id: `ask-${id}`,
    role: "assistant",
    content: "",
    toolCalls: [
      {
        id,
        type: "function",
        function: {
          name: "ask_user",
          arguments: JSON.stringify({
            questions: [
              { id: "preference", question: "Which style do you prefer?" },
            ],
          }),
        },
      },
    ],
  };
}

const searchCall: ToolCall = {
  id: "search",
  type: "function",
  function: { name: "search_knowledge", arguments: "{}" },
};
const searchResult: Message = {
  id: "search-result",
  role: "tool",
  toolCallId: "search",
  content: JSON.stringify({
    kind: "knowledge_search_result",
    query: "policy",
    error: null,
    sources: [
      {
        chunkId: "00000000-0000-4000-8000-000000000001",
        documentId: "00000000-0000-4000-8000-000000000002",
        name: "policy.pdf",
        page: 1,
        excerpt: "Keep the original receipt.",
        distance: 0.1,
      },
    ],
  }),
};
const answer: Message = {
  id: "answer-first",
  role: "tool",
  toolCallId: "first",
  content: JSON.stringify({
    answers: [{ id: "preference", answer: "Concise" }],
  }),
};

function reply(messages: Message[], status: ChatTurn["status"] = "running") {
  return createElement(AssistantReply, {
    turn: { id: "turn", user: null, messages, status },
    animatedMessageId: null,
  });
}

test.each([false, true])(
  "an open Sources reader and focus survive a later question (already asked: %s)",
  (alreadyAsked) => {
    const messages: Message[] = [
      ...(alreadyAsked ? [ask("first"), answer] : []),
      { id: "lookup", role: "assistant", content: "", toolCalls: [searchCall] },
      searchResult,
      {
        id: "commentary",
        role: "assistant",
        content: "I found the relevant policy.",
      },
    ];
    const view = render(reply(messages));

    fireEvent.click(view.getByRole("button", { name: "Sources · 1 document" }));
    const reader = view.getByRole("dialog", { name: "Sources" });
    const close = view.getByRole("button", { name: "Close sources" });

    close.focus();
    view.rerender(reply([...messages, ask("next")], "interrupted"));

    expect(view.getByRole("dialog", { name: "Sources" })).toBe(reader);
    expect(close).toHaveFocus();
  },
);

test("a failed continuation retains completed ordinary tools, Sources and downloadable files", () => {
  const call = ask("first");

  if (call.role !== "assistant") {
    throw new Error("Expected assistant fixture");
  }

  call.toolCalls!.push(searchCall, {
    id: "export",
    type: "function",
    function: {
      name: "run_skill_script",
      arguments: JSON.stringify({
        skill_name: "reports",
        script_path: "scripts/export.py",
      }),
    },
  });
  const view = render(
    reply(
      [
        call,
        answer,
        searchResult,
        {
          id: "export-result",
          role: "tool",
          toolCallId: "export",
          content: JSON.stringify({
            kind: "skill_script_result",
            exitCode: 0,
            stdout: "done",
            stderr: "",
            error: null,
            files: [
              {
                id: "00000000-0000-4000-8000-000000000001",
                threadId: "files",
                name: "report.csv",
                size: 20,
              },
            ],
          }),
        },
      ],
      "failed",
    ),
  );

  expect(
    view.getByRole("button", { name: "Sources · 1 document" }),
  ).toBeVisible();
  expect(view.getByRole("link", { name: /report.csv/ })).toBeVisible();
  expect(
    view.getByRole("button", { name: "Tool search_knowledge Completed" }),
  ).toBeVisible();
  expect(
    view.getByRole("button", { name: "Skill reports Completed" }),
  ).toBeVisible();
  expect(view.getByLabelText("Your clarification response")).toHaveTextContent(
    "Concise",
  );
  expect(view.queryByText("Results unavailable")).not.toBeInTheDocument();
});

test("an open Sources reader survives the first resumed token after a confirmed answer", () => {
  const messages: Message[] = [
    { id: "lookup", role: "assistant", content: "", toolCalls: [searchCall] },
    searchResult,
    ask("first"),
    answer,
  ];
  const view = render(reply(messages));

  fireEvent.click(view.getByRole("button", { name: "Sources · 1 document" }));
  const reader = view.getByRole("dialog", { name: "Sources" });
  const close = view.getByRole("button", { name: "Close sources" });

  close.focus();
  view.rerender(
    reply([
      ...messages,
      { id: "resumed", role: "assistant", content: "I will keep it concise." },
    ]),
  );

  expect(view.getByRole("dialog", { name: "Sources" })).toBe(reader);
  expect(close).toHaveFocus();
});
