// @vitest-environment jsdom
import { expect, test } from "vitest";
import {
  forgetAllConversations,
  loadConversation,
  saveConversation,
} from "./storage";

test("switching conversations keeps each unconfirmed submission recoverable", () => {
  const pending = {
    runId: "original-run",
    messageId: "original-message",
    messages: [
      { id: "original-message", role: "user" as const, content: "Hello" },
    ],
    state: {},
  };

  saveConversation({ threadId: "first", pending, empty: false });
  saveConversation({ threadId: "second", empty: true });

  expect(loadConversation().threadId).toBe("second");
  expect(loadConversation("first").pending).toEqual(pending);
  expect(loadConversation("unknown")).toEqual({ threadId: "unknown" });
});

test("the legacy current pointer can still be opened by ID", () => {
  localStorage.setItem(
    "agent-playground-conversation",
    JSON.stringify({ threadId: "legacy", empty: false }),
  );

  expect(loadConversation("legacy")).toEqual({
    threadId: "legacy",
    empty: false,
  });
  saveConversation({ threadId: "new", empty: true });
  expect(loadConversation("legacy")).toEqual({
    threadId: "legacy",
    empty: false,
  });
});

test("clearing conversation pointers preserves preferences and other browser data", () => {
  saveConversation({ threadId: "first", empty: false });
  saveConversation({ threadId: "second", empty: false });
  localStorage.setItem("agent-playground-preferences", '{"theme":"dark"}');
  localStorage.setItem("agent-playground-sidebar-width", "336");
  localStorage.setItem("other-app-data", "keep");

  forgetAllConversations();

  expect(localStorage.getItem("agent-playground-conversation")).toBeNull();
  expect(
    localStorage.getItem("agent-playground-conversation:first"),
  ).toBeNull();
  expect(
    localStorage.getItem("agent-playground-conversation:second"),
  ).toBeNull();
  expect(localStorage.getItem("agent-playground-preferences")).toBe(
    '{"theme":"dark"}',
  );
  expect(localStorage.getItem("agent-playground-sidebar-width")).toBe("336");
  expect(localStorage.getItem("other-app-data")).toBe("keep");
});
