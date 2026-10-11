// @vitest-environment jsdom
import { createElement } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, onTestFinished, test, vi } from "vitest";
import { useConversationHistory } from "./useConversationHistory";

const saved = {
  threadId: "saved",
  title: "Saved discussion",
  status: "completed",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0 } },
  });
  const cleared = vi.fn();

  onTestFinished(() => client.clear());

  return {
    client,
    cleared,
    ...renderHook(
      () =>
        useConversationHistory(
          () => undefined,
          () => undefined,
          cleared,
        ),
      {
        wrapper: ({ children }) =>
          createElement(QueryClientProvider, { client }, children),
      },
    ),
  };
}

test("a failed next page retains the loaded page and retry fetches only the failed cursor", async () => {
  const requests: string[] = [];
  let fail = true;

  vi.stubGlobal("fetch", (url: string) => {
    requests.push(url);

    if (url.includes("cursor") && fail) {
      return Promise.resolve(new Response(null, { status: 503 }));
    }

    return Promise.resolve(
      Response.json(
        url.includes("cursor")
          ? {
              conversations: [
                { ...saved, threadId: "older", title: "Older discussion" },
              ],
              nextCursor: null,
            }
          : { conversations: [saved], nextCursor: "older" },
      ),
    );
  });
  const { result } = setup();

  await waitFor(() => expect(result.current.conversations).toHaveLength(1));
  act(() => result.current.loadMore());
  await waitFor(() =>
    expect(result.current.error).toBe("Conversation history is unavailable"),
  );
  expect(result.current.conversations.map((entry) => entry.threadId)).toEqual([
    "saved",
  ]);
  fail = false;
  act(() => result.current.retry());
  await waitFor(() =>
    expect(result.current.conversations.map((entry) => entry.threadId)).toEqual(
      ["saved", "older"],
    ),
  );
  expect(result.current.error).toBeNull();
  expect(result.current.hasMore).toBe(false);
  expect(requests).toEqual([
    "/conversations",
    "/conversations?cursor=older",
    "/conversations?cursor=older",
    "/conversations?cursor=older",
  ]);
});

test("a rejected clear preserves loaded history, snapshot caches and local conversation pointers", async () => {
  vi.stubGlobal("fetch", (_url: string, init?: RequestInit) =>
    Promise.resolve(
      init?.method === "DELETE"
        ? Response.json(
            { error: "Wait for the run to finish" },
            { status: 409 },
          )
        : Response.json({ conversations: [saved], nextCursor: null }),
    ),
  );
  localStorage.setItem(
    "agent-playground-conversation",
    '{"threadId":"saved","empty":false}',
  );
  const { result, client, cleared } = setup();

  client.setQueryData(["conversation", "saved"], { title: "Saved discussion" });
  await waitFor(() => expect(result.current.conversations).toHaveLength(1));
  await expect(result.current.clear()).rejects.toThrow(
    "Wait for the run to finish",
  );
  expect(result.current.conversations.map((entry) => entry.threadId)).toEqual([
    "saved",
  ]);
  expect(client.getQueryData(["conversation", "saved"])).toEqual({
    title: "Saved discussion",
  });
  expect(localStorage.getItem("agent-playground-conversation")).toBe(
    '{"threadId":"saved","empty":false}',
  );
  expect(cleared).not.toHaveBeenCalled();
});
