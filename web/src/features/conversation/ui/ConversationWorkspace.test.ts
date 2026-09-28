import "../../../../tests/dom";
import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { createElement } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RunAgentInputSchema } from "@ag-ui/client";
import { ConversationProvider, useConversation } from "../ConversationProvider";
import type { ConversationSnapshot } from "../api/contracts";
import { ConversationWorkspace } from "./ConversationWorkspace";

afterEach(cleanup);

function ExecutionStatus() {
  const execution = useConversation((state) => state.lifecycle.execution);

  return createElement("output", { "data-testid": "execution" }, execution);
}

void test("the composer waits for the display buffer and final fade after the run completes", async (context) => {
  const client = new QueryClient();
  const text = "清晨的城市逐渐醒来，人们走向各自的生活。".repeat(80);
  let snapshot: ConversationSnapshot | null = null;
  let finish: (() => void) | undefined;
  let emitText: (() => void) | undefined;

  context.after(() => client.clear());
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: () => undefined,
  });
  context.after(() =>
    Reflect.deleteProperty(HTMLElement.prototype, "scrollTo"),
  );
  context.mock.method(
    globalThis,
    "fetch",
    (url: string, init?: RequestInit) => {
      if (url === "/health") {
        return Promise.resolve(new Response());
      }

      if (url.startsWith("/conversations/")) {
        return Promise.resolve(Response.json(snapshot));
      }

      assert.equal(url, "/agent");
      const input = RunAgentInputSchema.parse(JSON.parse(init!.body as string));

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
              emitText = () => {
                emit({
                  type: "TEXT_MESSAGE_START",
                  messageId: "reply",
                  role: "assistant",
                });
                emit({
                  type: "TEXT_MESSAGE_CONTENT",
                  messageId: "reply",
                  delta: text,
                });
              };
              finish = () => {
                snapshot = {
                  messages: [
                    ...input.messages,
                    { id: "reply", role: "assistant", content: text },
                  ],
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
  const conversation = {
    threadId: "display-completion",
    fresh: true as const,
    empty: true,
  };
  const page = render(
    createElement(
      QueryClientProvider,
      { client },
      createElement(ConversationProvider, {
        conversation,
        children: createElement(
          "div",
          null,
          createElement(ExecutionStatus),
          createElement(ConversationWorkspace, {
            conversation,
            development: false,
            onNewConversation: () => undefined,
          }),
        ),
      }),
    ),
  );
  const input = page.getByRole("textbox", {
    name: "Message",
  }) as HTMLTextAreaElement;

  fireEvent.change(input, { target: { value: "Write an article" } });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => assert.ok(emitText));
  await act(() => Promise.resolve(emitText!()));
  await waitFor(() =>
    assert.ok(
      page.getByLabelText("Assistant reply").textContent?.startsWith("清"),
    ),
  );
  const focusTarget = page.getAllByRole("button", {
    name: /^New conversation$/,
  })[0]!;

  focusTarget.focus();
  await act(() => Promise.resolve(finish!()));
  await waitFor(() =>
    assert.equal(page.getByTestId("execution").textContent, "idle"),
  );

  assert.ok(
    (page.getByLabelText("Assistant reply").textContent?.length ?? 0) <
      text.length,
  );
  assert.equal(
    input.disabled,
    true,
    "The completed run still has buffered text to show",
  );
  await waitFor(
    () =>
      assert.equal(page.getByLabelText("Assistant reply").textContent, text),
    { timeout: 4000 },
  );

  assert.equal(
    input.disabled,
    true,
    "The last visible text still needs to finish fading",
  );
  assert.ok(page.container.querySelector("[data-sd-animate]"));
  await waitFor(() => assert.equal(input.disabled, false), { timeout: 1500 });

  assert.equal(page.container.querySelectorAll("[data-sd-animate]").length, 0);
  assert.ok(
    document.activeElement === focusTarget,
    "Finishing the reply must preserve the user's current focus",
  );
});
