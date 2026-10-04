import { expect, test, vi } from "vitest";
import { subscribeConversationChanges } from "./events";

test("ready and changed refresh the snapshot and unsubscribe closes the connection", () => {
  const listeners = new Map<string, () => void>();
  const close = vi.fn();
  const source = {
    addEventListener: (name: string, listener: () => void) =>
      listeners.set(name, listener),
    close,
  };
  const refresh = vi.fn();
  const create = vi.fn(() => source);
  const unsubscribe = subscribeConversationChanges(
    "thread / 1",
    refresh,
    create,
  );

  expect(create).toHaveBeenCalledWith("/conversations/thread%20%2F%201/events");
  listeners.get("ready")!();
  listeners.get("changed")!();
  expect(refresh).toHaveBeenCalledTimes(2);
  unsubscribe();
  expect(close).toHaveBeenCalledOnce();
});
