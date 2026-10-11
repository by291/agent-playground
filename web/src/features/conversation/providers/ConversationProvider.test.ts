// @vitest-environment jsdom
import { test, onTestFinished, vi } from "vitest";
import assert from "node:assert/strict";
import { createElement, useState } from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RunAgentInputSchema } from "@shared/ag-ui-schemas";
import { ConversationProvider, useConversation } from "./ConversationProvider";
import { MessageComposer } from "../ui/composer/MessageComposer";
import type { ConversationSnapshot } from "../api/contracts";
import { messageText } from "../model/presentation";

function Messages() {
  const text = useConversation((state) =>
    state.messages.map(messageText).join("|"),
  );

  return createElement("output", null, text);
}

function DraftComposer() {
  const [prompt, setPrompt] = useState("");

  return createElement(MessageComposer, { prompt, onPromptChange: setPrompt });
}

test("a fresh page makes no snapshot request until its stream settles and restored history is delivered", async () => {
  const client = new QueryClient();

  onTestFinished(() => client.clear());
  let snapshots = 0;
  let submissions = 0;
  let snapshot: ConversationSnapshot | null = null;
  let finishStream: (() => void) | undefined;

  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    if (url === "/agent-info") {
      return Promise.resolve(Response.json({ model: "test-model" }));
    }

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
                new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`),
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
  });

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

test("server notifications refresh an open conversation and switching away releases the subscription", async () => {
  const listeners = new Map<string, () => void>();
  const close = vi.fn();
  const create = vi.fn();

  vi.stubGlobal(
    "EventSource",
    class {
      constructor(url: string) {
        create(url);
      }

      addEventListener(name: string, listener: () => void) {
        listeners.set(name, listener);
      }

      close() {
        close();
      }
    },
  );
  let text = "Preparing data";
  let reads = 0;

  vi.stubGlobal("fetch", () => {
    reads++;

    return Promise.resolve(
      Response.json({
        messages: [{ id: "reply", role: "assistant", content: text }],
        outputs: [],
        interrupts: [],
        runs: [{ runId: "run", status: "completed" }],
      }),
    );
  });
  const client = new QueryClient();

  onTestFinished(() => client.clear());
  const screen = render(
    createElement(
      QueryClientProvider,
      { client },
      createElement(ConversationProvider, {
        conversation: { threadId: "external-thread" },
        children: createElement(Messages),
      }),
    ),
  );

  await waitFor(() =>
    assert.equal(screen.getByRole("status").textContent, "Preparing data"),
  );
  assert.equal(
    create.mock.calls[0]?.[0],
    "/conversations/external-thread/events",
  );
  text = "Report ready";
  act(() => {
    listeners.get("changed")!();
  });
  await waitFor(() =>
    assert.equal(screen.getByRole("status").textContent, "Report ready"),
  );
  assert.ok(reads >= 2);
  screen.unmount();
  assert.equal(close.mock.calls.length, 1);
});
