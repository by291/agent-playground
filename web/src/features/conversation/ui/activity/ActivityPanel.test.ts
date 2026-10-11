// @vitest-environment jsdom
import { createElement } from "react";
import { fireEvent, render, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, onTestFinished, test, vi } from "vitest";
import { ConversationProvider } from "../../providers/ConversationProvider";
import { ActivityPanel } from "./ActivityPanel";
import { MessageComposer } from "../composer/MessageComposer";
test("a transport failure before any events appears in activity and its exported log", async () => {
  const client = new QueryClient();
  const writeText = vi
    .fn<(text: string) => Promise<void>>()
    .mockResolvedValue(undefined);
  const originalClipboard = Object.getOwnPropertyDescriptor(
    navigator,
    "clipboard",
  );

  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  onTestFinished(() => {
    client.clear();

    if (originalClipboard) {
      Object.defineProperty(navigator, "clipboard", originalClipboard);
    } else {
      Reflect.deleteProperty(navigator, "clipboard");
    }
  });
  vi.stubGlobal("fetch", (url: string) => {
    if (url === "/agent-info") {
      return Promise.resolve(Response.json({ model: "test-model" }));
    }

    return Promise.resolve(
      Response.json(
        { error: "Transport unavailable" },
        { status: url === "/agent" ? 503 : 404 },
      ),
    );
  });
  const page = render(
    createElement(
      QueryClientProvider,
      { client },
      createElement(ConversationProvider, {
        conversation: { threadId: "failed", fresh: true, empty: true },
        children: createElement(
          "div",
          null,
          createElement(MessageComposer, {
            prompt: "Inspect a connection failure",
            onPromptChange: () => undefined,
          }),
          createElement(ActivityPanel, {
            threadId: "failed",
            onClose: () => undefined,
          }),
        ),
      }),
    ),
  );
  const panel = within(
    page.getByRole("complementary", { name: "Run activity" }),
  );

  fireEvent.keyDown(page.getByRole("textbox", { name: "Message" }), {
    key: "Enter",
  });
  expect(await panel.findByRole("alert")).toHaveTextContent("503");
  fireEvent.click(panel.getByRole("button", { name: "Copy log" }));
  expect(await panel.findByRole("status")).toHaveTextContent("Log copied");
  const log = JSON.parse(writeText.mock.calls[0]![0]) as {
    received: number;
    events: unknown[];
    clientIssues: { run: string };
  };

  expect(log.received).toBe(0);
  expect(log.events).toEqual([]);
  expect(log.clientIssues.run).toContain("503");
});
