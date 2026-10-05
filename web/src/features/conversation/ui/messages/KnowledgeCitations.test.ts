// @vitest-environment jsdom
import { createElement } from "react";
import { render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { AssistantReply } from "./AssistantReply";
import { chatTurns } from "../../model/turns";
import { animationClock } from "../../../../../tests/animationClock";

const first = "00000000-0000-4000-8000-000000000001";
const second = "00000000-0000-4000-8000-000000000002";
const third = "00000000-0000-4000-8000-000000000003";
const documentId = "00000000-0000-4000-8000-000000000010";
const source = (chunkId: string, page: number, excerpt: string) => ({
  chunkId,
  documentId,
  name: "policy.pdf",
  page,
  excerpt,
  distance: 0.1,
});

function reply(text: string, streaming = false) {
  const turn = chatTurns(
    [
      {
        id: "searches",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "search-1",
            type: "function",
            function: { name: "search_knowledge", arguments: "{}" },
          },
          {
            id: "search-2",
            type: "function",
            function: { name: "search_knowledge", arguments: "{}" },
          },
        ],
      },
      {
        id: "results-1",
        role: "tool",
        toolCallId: "search-1",
        content: JSON.stringify({
          kind: "knowledge_search_result",
          query: "returns",
          error: null,
          sources: [
            source(first, 3, "Returns within 30 days."),
            source(second, 4, "Bring the original receipt."),
          ],
        }),
      },
      {
        id: "results-2",
        role: "tool",
        toolCallId: "search-2",
        content: JSON.stringify({
          kind: "knowledge_search_result",
          query: "receipts",
          error: null,
          sources: [
            source(second, 4, "Bring the original receipt."),
            source(third, 5, "Digital receipts are accepted."),
          ],
        }),
      },
      { id: "answer", role: "assistant", content: text },
    ],
    [],
  )[0]!;

  turn.status = streaming ? "running" : "completed";

  return createElement(AssistantReply, {
    turn,
    animatedMessageId: streaming ? "answer" : null,
  });
}

test("answer citations open their exact passage and reuse identities across repeated searches", async () => {
  const view = render(
    reply(
      `Returns have a time limit [source](#knowledge-source-${first}). Bring a receipt [source](#knowledge-source-${second}). Digital receipts work too [source](#knowledge-source-${third}). Keep that receipt [source](#knowledge-source-${second}).`,
    ),
  );
  const user = userEvent.setup();
  const citations = await view.findAllByRole("button", {
    name: "Source 2: policy.pdf, page 4",
  });

  expect(citations).toHaveLength(2);
  expect(citations[0]).toHaveTextContent("[2]");
  expect(
    view.getByRole("button", { name: "Source 3: policy.pdf, page 5" }),
  ).toHaveTextContent("[3]");
  await user.click(citations[0]!);
  const reader = within(view.getByRole("dialog", { name: "Sources" }));

  expect(reader.getByText("Bring the original receipt.")).toBeInTheDocument();
  expect(reader.getByText("Page 4")).toBeInTheDocument();
  expect(reader.getByText("Source [2]")).toBeInTheDocument();
  expect(reader.getByText("Passage 2 of 3")).toBeInTheDocument();
  await user.keyboard("{Escape}");
  expect(view.queryByRole("dialog")).toBeNull();
  expect(citations[0]).toHaveFocus();
});

test("unknown references stay unavailable and ordinary links and code remain Markdown", async () => {
  const unknown = "00000000-0000-4000-8000-000000000099";
  const view = render(
    reply(
      `A claim [source](#knowledge-source-${unknown}). See [the website](https://example.com). Literal syntax: \`[source](#knowledge-source-${first})\`.`,
    ),
  );

  expect(await view.findByText("[?]")).toHaveAttribute(
    "title",
    "Source unavailable",
  );
  expect(view.queryByRole("button", { name: /^Source [0-9]/ })).toBeNull();
  expect(view.getByRole("button", { name: "the website" })).toBeInTheDocument();
  expect(
    view.getByText(`[source](#knowledge-source-${first})`, {
      selector: "code",
    }),
  ).toBeInTheDocument();
});

test("streamed citations keep their numbers as links complete and later paragraphs arrive", () => {
  const clock = animationClock();
  const partial = "Bring a receipt [source](#knowledge-source-";
  const view = render(reply(partial, true));

  clock.advance(10_000);
  expect(view.queryByRole("button", { name: /^Source [0-9]/ })).toBeNull();
  const opening = `${partial}${second}).`;

  view.rerender(reply(opening, true));
  clock.advance(10_000);
  expect(
    view.getByRole("button", { name: "Source 2: policy.pdf, page 4" }),
  ).toHaveTextContent("[2]");
  const complete = `${opening}\n\nReturns have a time limit [source](#knowledge-source-${first}).`;

  view.rerender(reply(complete, true));
  clock.advance(10_000);
  expect(
    view.getByRole("button", { name: "Source 1: policy.pdf, page 3" }),
  ).toHaveTextContent("[1]");
  view.rerender(reply(complete));
  clock.advance(10_000);
  expect(
    view.getByRole("button", { name: "Source 2: policy.pdf, page 4" }),
  ).toHaveTextContent("[2]");
  expect(clock.frames.size).toBe(0);
});
