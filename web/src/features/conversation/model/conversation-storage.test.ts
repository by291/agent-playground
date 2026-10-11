// @vitest-environment jsdom
import { expect, test, vi } from "vitest";
import {
  forgetAllConversations,
  forgetConversation,
  loadConversation,
  newConversation,
  saveConversation,
} from "./conversation-storage";

test("empty conversation drafts have no thread identity", () => {
  const allocate = vi.spyOn(crypto, "randomUUID");

  expect(newConversation()).toEqual({ empty: true, fresh: true });
  expect(newConversation().threadId).toBeUndefined();
  expect(allocate).not.toHaveBeenCalled();
});

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

test("optional pointers and deletion do not throw when browser storage is unavailable", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("Storage unavailable", "SecurityError");
  });
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
    throw new DOMException("Storage unavailable", "SecurityError");
  });

  expect(() =>
    saveConversation({ threadId: "thread", empty: true }),
  ).not.toThrow();
  expect(() => forgetConversation("thread")).not.toThrow();
});

test("pending admission remains recoverable even when the optional current pointer cannot be saved", () => {
  const original = Storage.prototype.setItem.bind(localStorage);

  vi.spyOn(Storage.prototype, "setItem").mockImplementation((key, value) => {
    if (key === "agent-playground-conversation") {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    }

    original(key, value);
  });
  const pending = {
    runId: "pending-run",
    messageId: "pending-message",
    messages: [
      {
        id: "pending-message",
        role: "user" as const,
        content: "Keep this request",
      },
    ],
    state: {},
  };

  expect(() => saveConversation({ threadId: "thread", pending })).not.toThrow();
  expect(loadConversation("thread").pending).toEqual(pending);
});

test("pending admission fails explicitly when its durable journal cannot be saved", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("Quota exceeded", "QuotaExceededError");
  });

  expect(() =>
    saveConversation({
      threadId: "thread",
      pending: {
        runId: "run",
        messageId: "message",
        messages: [],
        state: {},
      },
    }),
  ).toThrow();
});
