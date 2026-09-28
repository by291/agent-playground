import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import type { SavedConversation } from "@/features/conversation";

function renderInitialPage(saved: SavedConversation | null, pathname = "/") {
  Object.defineProperty(globalThis, "window", {
    value: { location: { pathname } },
    configurable: true,
  });
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: () => JSON.stringify(saved),
      setItem: () =>
        assert.fail("Initial rendering must preserve the conversation"),
    },
    configurable: true,
  });
  const client = new QueryClient();

  try {
    return renderToStaticMarkup(
      createElement(QueryClientProvider, { client }, createElement(App)),
    );
  } finally {
    client.clear();
    Reflect.deleteProperty(globalThis, "window");
    Reflect.deleteProperty(globalThis, "localStorage");
  }
}

void test("refreshing a conversation renders its page layout while history recovers", () => {
  const markup = renderInitialPage({ threadId: "saved-conversation" });

  assert.match(
    markup,
    /<header\b/,
    "The page layout must be present immediately",
  );
  assert.match(markup, /placeholder="Message Agent Playground"/);
  assert.match(markup, /aria-label="Messages"/);
  assert.match(markup, /aria-busy="true"/);
  assert.doesNotMatch(markup, /Loading conversation/);
  assert.doesNotMatch(markup, /A place to think out loud/);
});

void test("a new or saved empty conversation renders the welcome screen immediately", () => {
  for (const saved of [null, { threadId: "empty-conversation", empty: true }]) {
    const markup = renderInitialPage(saved);

    assert.match(markup, /A place to think out loud/);
    assert.match(markup, /Start a conversation/);
    assert.doesNotMatch(markup, /aria-busy="true"/);
    assert.doesNotMatch(markup, /animate-pulse/);
    assert.doesNotMatch(markup, /Loading conversation/);
  }
});

void test("a pending submission requires recovery even when its old empty marker remains", () => {
  const markup = renderInitialPage({
    threadId: "pending-conversation",
    empty: true,
    pending: {
      runId: "pending-run",
      messageId: "input",
      messages: [{ id: "input", role: "user", content: "Hello" }],
      state: {},
    },
  });

  assert.match(markup, /aria-busy="true"/);
  assert.doesNotMatch(markup, /A place to think out loud/);
});

void test("rendering without development mode omits debug tool controls", () => {
  const markup = renderInitialPage(null);

  assert.doesNotMatch(markup, /A2UI components \(opens in a new tab\)/);
  assert.doesNotMatch(markup, /Show run activity/);
});

void test("developer and retired routes are unavailable without development mode", () => {
  for (const path of ["/dev/a2ui-components", "/a2ui"]) {
    const markup = renderInitialPage(null, path);

    assert.match(markup, /Page not found/);
    assert.doesNotMatch(markup, /JSON example/);
  }
});
