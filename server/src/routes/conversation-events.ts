import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { subscribeConversationChanges } from "../conversation/events/subscription.js";

const heartbeatIntervalMs = 15_000;

/** Forwards conversation invalidations until the request or shared listener ends. */
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
      // Serialize writes so ready stays ahead of changes and heartbeats.
      pending = pending
        .then(() => stream.writeSSE({ event, data: "{}" }))
        .catch(close);
    }

    // A failed shared listener closes these streams. EventSource reconnects and
    // the next ready event makes clients refetch changes missed while offline.
    const unsubscribe = subscribeConversationChanges(threadId, {
      ready() {
        enqueue("ready");
        heartbeat = setInterval(
          () => enqueue("heartbeat"),
          heartbeatIntervalMs,
        );
      },
      changed: () => enqueue("changed"),
      close,
    });

    try {
      await closed;
    } finally {
      // The stream owns these callbacks; the hub owns its shared PostgreSQL connection.
      signal.removeEventListener("abort", close);
      clearInterval(heartbeat);
      unsubscribe();
    }
  });
}
