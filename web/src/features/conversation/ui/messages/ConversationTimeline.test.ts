// @vitest-environment jsdom
import { expect, test, onTestFinished, vi } from "vitest";
import assert from "node:assert/strict";
import { createElement } from "react";
import { render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConversationProvider } from "../../providers/ConversationProvider";
import { ConversationTimeline } from "./ConversationTimeline";
import type { ConversationSnapshot } from "../../api/contracts";
import { RunAgentInputSchema } from "@shared/ag-ui-schemas";
import type { RunAgentInput } from "@ag-ui/client";

test("restored turns expose measurable message items directly to the scroll controller", async () => {
  const client = new QueryClient();
  const article = "First paragraph.\n\nSecond paragraph.";
  const snapshot: ConversationSnapshot = {
    messages: [
      {
        id: "question-1",
        role: "user",
        content: "Write an article",
      },
      {
        id: "reply-1",
        role: "assistant",
        content: article,
      },
      {
        id: "question-2",
        role: "user",
        content: "Write another article",
      },
      {
        id: "reply-2",
        role: "assistant",
        content: article,
      },
    ],
    outputs: [],
    interrupts: [],
    runs: [
      {
        runId: "run-1",
        messageId: "question-1",
        status: "completed",
      },
      {
        runId: "run-2",
        messageId: "question-2",
        status: "completed",
      },
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

test("a prepared submission can be retried from the conversation timeline", async () => {
  const client = new QueryClient();
  const requests: RunAgentInput[] = [];
  const threadId = "retry-prepared-timeline";
  const runId = "original-run";
  const messageId = "original-message";
  const message = {
    id: messageId,
    role: "user" as const,
    content: "Retry my original message",
  };
  const snapshot: ConversationSnapshot = {
    messages: [],
    outputs: [],
    interrupts: [],
    runs: [
      {
        runId,
        messageId,
        status: "prepared",
      },
    ],
  };

  onTestFinished(() => client.clear());
  vi.stubGlobal("fetch", (url: string, options?: RequestInit) => {
    if (url !== "/agent") {
      return Promise.resolve(Response.json(snapshot));
    }

    const request = RunAgentInputSchema.parse(
      JSON.parse(options?.body as string),
    );

    requests.push(request);

    if (requests.length === 1) {
      return Promise.reject(new TypeError("Admission response was lost"));
    }

    snapshot.runs = [
      {
        runId,
        messageId,
        status: "completed",
      },
    ];
    snapshot.messages = [message];

    const start = {
      type: "RUN_STARTED",
      threadId,
      runId,
    };
    const finish = { ...start, type: "RUN_FINISHED" };
    const events = [start, finish]
      .map((event) => `data: ${JSON.stringify(event)}\n\n`)
      .join("");

    return Promise.resolve(
      new Response(events, {
        headers: { "Content-Type": "text/event-stream" },
      }),
    );
  });
  const page = render(
    createElement(
      QueryClientProvider,
      { client },
      createElement(ConversationProvider, {
        conversation: {
          threadId,
          pending: {
            runId,
            messageId,
            messages: [message],
            state: {},
          },
        },
        children: createElement(ConversationTimeline),
      }),
    ),
  );
  const retry = await page.findByRole("button", { name: "Retry submission" });
  const user = userEvent.setup();

  expect(requests).toHaveLength(1);
  await user.click(retry);
  await waitFor(() => expect(requests).toHaveLength(2));
  expect(requests[1]).toEqual(requests[0]);
  await waitFor(() => expect(retry).not.toBeInTheDocument());
  expect(page.getByText(message.content)).toBeVisible();
});
