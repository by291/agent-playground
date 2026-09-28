import assert from "node:assert/strict";
import test from "node:test";
import { EventType, type RunAgentInput } from "@ag-ui/client";
import { Hono } from "hono";
import { of } from "rxjs";
import { streamAgent } from "./agent-stream";

void test("model context snapshots cannot replace the public transcript or expose summaries", async () => {
  const input: RunAgentInput = {
    threadId: "thread",
    runId: "run",
    messages: [],
    tools: [],
    context: [],
    state: {},
  };
  const app = new Hono();

  app.get("/stream", (context) =>
    streamAgent(context, input, () => ({
      events: of(
        {
          type: EventType.RUN_STARTED as const,
          threadId: "thread",
          runId: "run",
        },
        {
          type: EventType.STATE_SNAPSHOT as const,
          snapshot: {
            messages: [{ content: "Private summary" }],
            response_messages: [],
            context_usage: { revision: 4 },
          },
        },
        {
          type: EventType.MESSAGES_SNAPSHOT as const,
          messages: [
            {
              id: "summary",
              role: "user" as const,
              content: "Private summary",
            },
          ],
        },
        {
          type: EventType.RUN_FINISHED as const,
          threadId: "thread",
          runId: "run",
        },
      ),
      settle: () => Promise.resolve(),
    })),
  );
  const response = await app.request("/stream");
  const output = await response.text();

  assert.doesNotMatch(
    output,
    /Private summary|MESSAGES_SNAPSHOT|response_messages/,
  );
  assert.match(output, /context_usage/);
});
