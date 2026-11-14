import { test } from "vitest";
import assert from "node:assert/strict";
import { EventSchemas } from "@ag-ui/core/schemas";
import { EventType, type RunAgentInput } from "@ag-ui/client";
import { Hono } from "hono";
import { concat, of, throwError } from "rxjs";
import { streamAgent } from "./run-stream.js";

const input: RunAgentInput = {
  threadId: "thread",
  runId: "run",
  messages: [],
  tools: [],
  context: [],
  state: {},
};

const sseDataPrefix = "data: ";

function readEvents(output: string) {
  const lines = output.split("\n\n");
  const eventLines = lines.filter((line) => line.startsWith(sseDataPrefix));

  return eventLines.map((line) => {
    const body: unknown = JSON.parse(line.slice(sseDataPrefix.length));

    return EventSchemas.parse(body);
  });
}

test("model context snapshots cannot replace the public transcript or expose summaries", async () => {
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
          type: EventType.STATE_SNAPSHOT as const,
          snapshot: {
            messages: [
              {
                id: "error-result",
                type: "tool",
                tool_call_id: "plan",
                status: "error",
                content: "Missing idea",
              },
            ],
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

  const events = readEvents(output);
  const failure = events.find((event) => {
    if (event.type !== EventType.STATE_SNAPSHOT) {
      return false;
    }

    const snapshot = event.snapshot as Record<string, unknown>;

    return Array.isArray(snapshot.toolErrors) && snapshot.toolErrors.length > 0;
  });

  assert.ok(failure?.type === EventType.STATE_SNAPSHOT);

  assert.deepEqual((failure.snapshot as Record<string, unknown>).toolErrors, [
    {
      id: "error-result",
      role: "tool",
      toolCallId: "plan",
      content: "Missing idea",
      error: "Missing idea",
    },
  ]);
  assert.ok(
    events.indexOf(failure) <
      events.findIndex((event) => event.type === EventType.RUN_FINISHED),
  );
});

test("stream deduplicates public state while preserving tool error updates", async () => {
  const failure = {
    id: "result",
    type: "tool",
    tool_call_id: "clock",
    status: "error",
    content: "Clock unavailable",
  };
  const app = new Hono();

  app.get("/stream", (context) =>
    streamAgent(context, input, () => ({
      events: of(
        {
          type: EventType.STATE_SNAPSHOT as const,
          snapshot: {
            messages: [
              {
                id: "reply",
                type: "ai",
                content: "Checking",
              },
            ],
            context_usage: { revision: 1 },
          },
        },
        {
          type: EventType.STATE_SNAPSHOT as const,
          snapshot: {
            messages: [
              {
                id: "reply",
                type: "ai",
                content: "Checking…",
              },
            ],
            response_messages: [],
            context_usage: { revision: 1 },
          },
        },
        {
          type: EventType.STATE_SNAPSHOT as const,
          snapshot: {
            messages: [failure],
            response_messages: [failure],
            context_usage: { revision: 1 },
          },
        },
        {
          type: EventType.STATE_SNAPSHOT as const,
          snapshot: {
            messages: [failure],
            response_messages: [],
            context_usage: { revision: 2 },
          },
        },
      ),
      settle: () => Promise.resolve(),
    })),
  );

  const response = await app.request("/stream");
  const output = await response.text();
  const snapshots = readEvents(output).filter(
    (event) => event.type === EventType.STATE_SNAPSHOT,
  );

  assert.deepEqual(
    snapshots.map((event) => event.snapshot as unknown),
    [
      { context_usage: { revision: 1 }, toolErrors: [] },
      {
        context_usage: { revision: 1 },
        toolErrors: [
          {
            id: "result",
            role: "tool",
            toolCallId: "clock",
            content: "Clock unavailable",
            error: "Clock unavailable",
          },
        ],
      },
      {
        context_usage: { revision: 2 },
        toolErrors: [
          {
            id: "result",
            role: "tool",
            toolCallId: "clock",
            content: "Clock unavailable",
            error: "Clock unavailable",
          },
        ],
      },
    ],
  );
});

test("an upstream error follows events that were already queued for the client", async () => {
  const upstreamEvents = concat(
    of(
      {
        type: EventType.RUN_STARTED as const,
        threadId: input.threadId,
        runId: input.runId,
      },
      {
        type: EventType.TEXT_MESSAGE_CONTENT as const,
        messageId: "reply",
        delta: "First chunk",
      },
    ),
    throwError(() => new Error("Private upstream failure")),
  );

  const app = new Hono();

  app.get("/stream", (context) =>
    streamAgent(context, input, () => ({
      events: upstreamEvents,
      settle: () => Promise.resolve(),
    })),
  );

  const response = await app.request("/stream");
  const output = await response.text();
  const events = readEvents(output);

  assert.deepEqual(events, [
    {
      type: EventType.RUN_STARTED,
      threadId: input.threadId,
      runId: input.runId,
    },
    {
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: "reply",
      delta: "First chunk",
    },
    {
      type: EventType.RUN_ERROR,
      message: "Agent run failed",
    },
  ]);
});
