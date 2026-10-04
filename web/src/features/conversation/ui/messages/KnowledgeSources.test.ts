// @vitest-environment jsdom
import { createElement } from "react";
import { render } from "@testing-library/react";
import { expect, test } from "vitest";
import { AssistantReply } from "./AssistantReply";
import { chatTurns } from "../../model/turns";

test("restored retrieval sources stay available outside collapsed tool details", () => {
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
          ],
        }),
      },
    ],
    [],
  )[0]!;
  const view = render(
    createElement(AssistantReply, { turn, animatedMessageId: null }),
  );

  expect(
    view.getByRole("region", { name: "Retrieved sources" }),
  ).toBeInTheDocument();
  expect(view.getByText("policy.pdf · Page 3")).toBeInTheDocument();
  expect(
    view.getByRole("link", { name: "Download original" }).getAttribute("href"),
  ).toBe("/api/knowledge/documents/00000000-0000-4000-8000-000000000002/file");
});
