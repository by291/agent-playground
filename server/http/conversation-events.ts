import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { subscribeConversationChanges } from "../conversation/change-subscription";

export function streamConversationChanges(context: Context, threadId: string) {
  context.header("Cache-Control", "no-cache, no-transform");
  context.header("X-Accel-Buffering", "no");

  return streamSSE(context, async (stream) => {
    const signal = context.req.raw.signal;

    if (signal.aborted) {
      return;
    }

    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let pending = Promise.resolve();
    let close!: () => void;
    const closed = new Promise<void>((resolve) => {
      close = resolve;
    });

    stream.onAbort(close);
    signal.addEventListener("abort", close, { once: true });

    function enqueue(event: string) {
      pending = pending
        .then(() => stream.writeSSE({ event, data: "{}" }))
        .catch(close);
    }

    // A failed shared listener closes these streams. EventSource reconnects and
    // the next ready event makes clients refetch changes missed while offline.
    const unsubscribe = subscribeConversationChanges(threadId, {
      ready() {
        enqueue("ready");
        heartbeat = setInterval(() => enqueue("heartbeat"), 15000);
      },
      changed: () => enqueue("changed"),
      close,
    });

    try {
      await closed;
    } finally {
      signal.removeEventListener("abort", close);
      clearInterval(heartbeat);
      unsubscribe();
    }
  });
}
