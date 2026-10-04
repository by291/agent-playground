import pg from "pg";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";

export function streamConversationChanges(context: Context, threadId: string) {
  context.header("Cache-Control", "no-cache, no-transform");
  context.header("X-Accel-Buffering", "no");

  return streamSSE(context, async (stream) => {
    const client = new pg.Client({
      connectionString: process.env.APP_DATABASE_URL,
    });
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let pending = Promise.resolve();
    let close!: () => void;
    const closed = new Promise<void>((resolve) => {
      close = resolve;
    });

    stream.onAbort(close);
    client.on("error", close);
    client.on("notification", (notification) => {
      if (notification.payload === threadId) {
        pending = pending
          .then(() => stream.writeSSE({ event: "changed", data: "{}" }))
          .catch(close);
      }
    });

    try {
      await client.connect();
      await client.query("LISTEN conversation_changed");
      await stream.writeSSE({ event: "ready", data: "{}" });
      heartbeat = setInterval(() => {
        pending = pending
          .then(() => stream.writeSSE({ event: "heartbeat", data: "{}" }))
          .catch(close);
      }, 15000);
      await closed;
    } finally {
      clearInterval(heartbeat);
      await client.end();
    }
  });
}
