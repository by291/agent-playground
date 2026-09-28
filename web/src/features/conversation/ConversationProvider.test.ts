import "../../../tests/dom";
import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { createElement, useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RunAgentInputSchema } from "@ag-ui/client";
import { ConversationProvider, useConversation } from "./ConversationProvider";
import { Composer } from "./ui/Composer";
import type { ConversationSnapshot } from "./api/contracts";
import { messageText } from "./model/presentation";

afterEach(cleanup);

function Messages() {
  const text = useConversation((state) =>
    state.messages.map(messageText).join("|"),
  );

  return createElement("output", null, text);
}

function DraftComposer() {
  const [prompt, setPrompt] = useState("");

  return createElement(Composer, { prompt, onPromptChange: setPrompt });
}

void test("a fresh page makes no snapshot request until its stream settles and restored history is delivered", async (context) => {
  const client = new QueryClient();

  context.after(() => client.clear());
  let snapshots = 0;
  let submissions = 0;
  let snapshot: ConversationSnapshot | null = null;
  let finishStream: (() => void) | undefined;

  context.mock.method(
    globalThis,
    "fetch",
    (url: string, init?: RequestInit) => {
      if (url.startsWith("/conversations/")) {
        snapshots++;

        return Promise.resolve(
          snapshot
            ? Response.json(snapshot)
            : new Response(null, { status: 404 }),
        );
      }

      assert.equal(url, "/agent");
      assert.equal(typeof init?.body, "string");
      const input = RunAgentInputSchema.parse(JSON.parse(init!.body as string));

      submissions++;
      const finalMessage = {
        id: "reply",
        role: "assistant" as const,
        content: "Hello back",
      };

      return Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              function emit(event: object) {
                controller.enqueue(
                  new TextEncoder().encode(
                    `data: ${JSON.stringify(event)}\n\n`,
                  ),
                );
              }

              emit({
                type: "RUN_STARTED",
                threadId: input.threadId,
                runId: input.runId,
              });
              finishStream = () => {
                snapshot = {
                  messages: [...input.messages, finalMessage],
                  outputs: [],
                  interrupts: [],
                  runs: [
                    {
                      runId: input.runId,
                      messageId: input.messages.at(-1)!.id,
                      status: "completed",
                    },
                  ],
                };
                emit({
                  type: "TEXT_MESSAGE_START",
                  messageId: "reply",
                  role: "assistant",
                });
                emit({
                  type: "TEXT_MESSAGE_CONTENT",
                  messageId: "reply",
                  delta: "Hello back",
                });
                emit({ type: "TEXT_MESSAGE_END", messageId: "reply" });
                emit({
                  type: "RUN_FINISHED",
                  threadId: input.threadId,
                  runId: input.runId,
                });
                controller.close();
              };
            },
          }),
          { headers: { "Content-Type": "text/event-stream" } },
        ),
      );
    },
  );

  function page(fresh: boolean) {
    return createElement(
      QueryClientProvider,
      { client },
      createElement(ConversationProvider, {
        conversation: {
          threadId: "integration",
          empty: true,
          ...(fresh ? { fresh: true as const } : {}),
        },
        children: createElement(
          "div",
          null,
          createElement(Messages),
          createElement(DraftComposer),
        ),
      }),
    );
  }

  const mounted = render(page(true));
  const user = userEvent.setup();

  fireEvent.focus(window);
  assert.equal(snapshots, 0);
  await user.type(
    mounted.getByRole("textbox", { name: "Message" }),
    "Hello{Shift>}{Enter}{/Shift}there",
  );
  assert.equal(submissions, 0, "Shift+Enter must keep the draft");
  fireEvent.keyDown(mounted.getByRole("textbox", { name: "Message" }), {
    key: "Enter",
    isComposing: true,
  });
  assert.equal(submissions, 0, "IME confirmation must keep the draft");
  await user.keyboard("{Enter}");
  await waitFor(() => assert.equal(submissions, 1));
  assert.equal(
    snapshots,
    0,
    "A live fresh stream must not fetch or poll an absent snapshot",
  );
  assert.equal(
    mounted.getByRole("textbox", { name: "Message" }).hasAttribute("disabled"),
    true,
  );
  assert.ok(finishStream);
  await act(() => Promise.resolve(finishStream!()));
  await waitFor(() =>
    assert.equal(
      mounted
        .getByRole("textbox", { name: "Message" })
        .hasAttribute("disabled"),
      false,
    ),
  );

  assert.equal(
    snapshots,
    1,
    "Stream completion must request exactly one snapshot",
  );
  assert.match(mounted.getByRole("status").textContent ?? "", /Hello back/);
  mounted.unmount();
  const restored = render(page(false));

  await waitFor(() => assert.equal(snapshots, 2));
  await waitFor(() =>
    assert.equal(
      restored
        .getByRole("textbox", { name: "Message" })
        .hasAttribute("disabled"),
      false,
    ),
  );
  assert.match(restored.getByRole("status").textContent ?? "", /Hello back/);
  assert.equal(
    submissions,
    1,
    "Restoring a completed conversation must not resubmit it",
  );
});
