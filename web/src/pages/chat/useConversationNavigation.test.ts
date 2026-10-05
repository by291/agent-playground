// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { useConversationNavigation } from "./useConversationNavigation";

test("new conversation navigation stays on the draft route until the first submission", () => {
  window.history.replaceState(null, "", "/");
  const allocate = vi.spyOn(crypto, "randomUUID");
  const view = renderHook(() => useConversationNavigation());

  act(() => view.result.current.startNewConversation());
  act(() => view.result.current.startNewConversation());
  expect(window.location.pathname).toBe("/");
  expect(view.result.current.conversation.threadId).toBeUndefined();
  expect(allocate).not.toHaveBeenCalled();
  const key = view.result.current.conversationKey;

  act(() => view.result.current.activateConversation("first-submission"));
  expect(window.location.pathname).toBe("/c/first-submission");
  expect(view.result.current.conversation.threadId).toBe("first-submission");
  expect(view.result.current.conversationKey).toBe(key);

  act(() => view.result.current.startNewConversation());
  expect(window.location.pathname).toBe("/");
  expect(view.result.current.conversation.threadId).toBeUndefined();
  act(() => view.result.current.openConversation("first-submission"));
  expect(window.location.pathname).toBe("/c/first-submission");
});
