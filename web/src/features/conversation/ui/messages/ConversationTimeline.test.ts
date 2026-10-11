// @vitest-environment jsdom
import { test, onTestFinished, vi } from "vitest";
import assert from "node:assert/strict";
import { createElement } from "react";
import { render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConversationProvider } from "../../providers/ConversationProvider";
import { ConversationTimeline } from "./ConversationTimeline";
import type { ConversationSnapshot } from "../../api/contracts";

test("restored turns expose measurable message items directly to the scroll controller", async () => {
  const client = new QueryClient();
  const article = "First paragraph.\n\nSecond paragraph.";
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

  onTestFinished(() => client.clear());
  vi.stubGlobal("fetch", () => Promise.resolve(Response.json(snapshot)));
  const page = render(
    createElement(
      QueryClientProvider,
      { client },
      createElement(ConversationProvider, {
        conversation: { threadId: "long-articles" },
        children: createElement(ConversationTimeline),
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
