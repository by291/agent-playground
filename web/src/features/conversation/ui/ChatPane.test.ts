import "../../../../tests/dom";
import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { createElement } from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConversationProvider } from "../ConversationProvider";
import { ChatPane } from "./ChatPane";
import type { ConversationSnapshot } from "../api/contracts";

afterEach(cleanup);

void test("restored turns expose measurable message items directly to the scroll controller", async (context) => {
  const client = new QueryClient();
  const paragraph = "清晨的城市逐渐醒来，人们走向各自的生活。".repeat(20);
  const article = Array.from({ length: 10 }, () => paragraph).join("\n\n");
  const snapshot: ConversationSnapshot = {
    messages: [
      { id: "question-1", role: "user", content: "Write an article" },
      { id: "reply-1", role: "assistant", content: article },
      { id: "question-2", role: "user", content: "Write another article" },
      { id: "reply-2", role: "assistant", content: article },
    ],
    outputs: [],
    interrupts: [],
    runs: [
      { runId: "run-1", messageId: "question-1", status: "completed" },
      { runId: "run-2", messageId: "question-2", status: "completed" },
    ],
  };

  context.after(() => client.clear());
  context.mock.method(globalThis, "fetch", () =>
    Promise.resolve(Response.json(snapshot)),
  );
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: () => undefined,
  });
  context.after(() =>
    Reflect.deleteProperty(HTMLElement.prototype, "scrollTo"),
  );
  const page = render(
    createElement(
      QueryClientProvider,
      { client },
      createElement(ConversationProvider, {
        conversation: { threadId: "long-articles" },
        children: createElement(ChatPane),
      }),
    ),
  );

  await waitFor(() =>
    assert.equal(page.getAllByLabelText("Assistant reply").length, 2),
  );
  const items = page.container.querySelectorAll(
    '[data-slot="message-scroller-item"]',
  );
  const content = page.container.querySelector(
    '[data-slot="message-scroller-content"]',
  );

  assert.equal(items.length, 4);

  for (const item of items) {
    // The primitive measures direct children; display:contents wrappers have zero bounds.
    assert.ok(
      item.parentElement === content,
      "Each message must have measurable bounds for the controller",
    );
  }
});
