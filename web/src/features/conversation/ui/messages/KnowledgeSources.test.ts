// @vitest-environment jsdom
import { createElement } from "react";
import { render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { AssistantReply } from "./AssistantReply";
import { chatTurns } from "../../model/turns";

test("restored sources open a reader with document and passage navigation", async () => {
  const turn = chatTurns(
    [
      {
        id: "call",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "search",
            type: "function",
            function: { name: "search_knowledge", arguments: "{}" },
          },
        ],
      },
      {
        id: "result",
        role: "tool",
        toolCallId: "search",
        content: JSON.stringify({
          kind: "knowledge_search_result",
          query: "returns",
          error: null,
          sources: [
            {
              chunkId: "00000000-0000-4000-8000-000000000001",
              documentId: "00000000-0000-4000-8000-000000000002",
              name: "policy.pdf",
              page: 3,
              excerpt: "Returns within 30 days.",
              distance: 0.1,
            },
            {
              chunkId: "00000000-0000-4000-8000-000000000003",
              documentId: "00000000-0000-4000-8000-000000000002",
              name: "policy.pdf",
              page: 4,
              excerpt: "Bring the original receipt.",
              distance: 0.2,
            },
            {
              chunkId: "00000000-0000-4000-8000-000000000004",
              documentId: "00000000-0000-4000-8000-000000000005",
              name: "delivery.md",
              page: null,
              excerpt: "Delivery takes two days.",
              distance: 0.3,
            },
          ],
        }),
      },
    ],
    [],
  )[0]!;
  const view = render(
    createElement(AssistantReply, { turn, animatedMessageId: null }),
  );

  const user = userEvent.setup();
  const trigger = view.getByRole("button", { name: /Sources.*2 documents/ });

  expect(view.queryByText("Returns within 30 days.")).toBeNull();
  await user.click(trigger);
  const reader = within(view.getByRole("dialog", { name: "Sources" }));

  expect(reader.getByText("Returns within 30 days.")).toBeInTheDocument();
  expect(reader.getByText("Page 3")).toBeInTheDocument();
  await user.click(reader.getByRole("button", { name: "Next passage" }));
  expect(reader.getByText("Bring the original receipt.")).toBeInTheDocument();
  expect(reader.getByRole("combobox", { name: "Document" })).toHaveTextContent(
    "policy.pdf",
  );
  expect(
    reader
      .getByRole("link", { name: "Download original" })
      .getAttribute("href"),
  ).toBe("/api/knowledge/documents/00000000-0000-4000-8000-000000000002/file");
  await user.keyboard("{Escape}");
  expect(view.queryByRole("dialog")).toBeNull();
  expect(trigger).toHaveFocus();
});

test.each([
  {
    error: null,
    label: "Sources · No matches",
    detail: "No matching sources in the current index.",
  },
  {
    error: "Embedding service unavailable",
    label: "Sources unavailable",
    detail: "Embedding service unavailable",
  },
])(
  "the source reader explains $label without presenting an empty document selector",
  async ({ error, label, detail }) => {
    const turn = chatTurns(
      [
        {
          id: "search-call",
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "search",
              type: "function",
              function: { name: "search_knowledge", arguments: "{}" },
            },
          ],
        },
        {
          id: "search-result",
          role: "tool",
          toolCallId: "search",
          content: JSON.stringify({
            kind: "knowledge_search_result",
            query: "returns",
            sources: [],
            error,
          }),
        },
      ],
      [],
    )[0]!;
    const view = render(
      createElement(AssistantReply, { turn, animatedMessageId: null }),
    );
    const user = userEvent.setup();

    await user.click(view.getByRole("button", { name: label }));
    const reader = within(view.getByRole("dialog", { name: "Sources" }));

    expect(reader.getByText(detail)).toBeInTheDocument();
    expect(reader.queryByRole("combobox")).toBeNull();
    await user.click(reader.getByRole("button", { name: "Close sources" }));
    expect(view.queryByRole("dialog")).toBeNull();
  },
);
