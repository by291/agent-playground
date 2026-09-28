import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { conversationQueryOptions } from "./queries";

void test("thread-specific queries fetch the correct snapshot and treat a new thread as empty", async (context) => {
  context.mock.method(globalThis, "fetch", (url: string) =>
    Promise.resolve(
      url === "/conversations/existing%2Fthread"
        ? Response.json({
            messages: [
              { id: "saved", role: "assistant", content: "Recovered" },
            ],
            outputs: [],
            interrupts: [],
            runs: [{ runId: "run", status: "completed" }],
          })
        : new Response(null, { status: 404 }),
    ),
  );
  const client = new QueryClient();
  try {
    const existing = await client.fetchQuery(
      conversationQueryOptions("existing/thread"),
    );
    const empty = await client.fetchQuery(
      conversationQueryOptions("new-thread"),
    );
    assert.equal(existing?.messages[0]?.content, "Recovered");
    assert.equal(empty, null);
    assert.equal(
      client.getQueryData(conversationQueryOptions("existing/thread").queryKey),
      existing,
    );
  } finally {
    client.clear();
  }
});

void test("cancelling a conversation query aborts its HTTP request", async (context) => {
  let signal: AbortSignal | undefined;
  context.mock.method(
    globalThis,
    "fetch",
    (_url: string, init: RequestInit) => {
      signal = init.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      });
    },
  );
  const client = new QueryClient();
  const options = conversationQueryOptions("old-thread");
  const request = client.fetchQuery(options);
  const rejected = assert.rejects(request);
  await client.cancelQueries({ queryKey: options.queryKey });
  await rejected;
  assert.equal(signal?.aborted, true);
  client.clear();
});
