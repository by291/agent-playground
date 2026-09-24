import { afterEach, describe, expect, it } from "vitest";
import { EventType, type BaseEvent } from "@ag-ui/core";
import { EventSchema } from "@ag-ui/core/schemas";
import type { Server } from "node:http";
import { createHttpServer } from "../src/http.js";
import type { AgentRuntime } from "../src/runtime.js";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function start(runtime: AgentRuntime): Promise<string> {
  const server = createHttpServer(runtime);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP address.");
  return `http://127.0.0.1:${address.port}`;
}

const input = {
  threadId: "thread-1",
  runId: "run-1",
  messages: [{ id: "message-1", role: "user", content: "Hello" }],
};

function post(url: string, body: unknown) {
  return fetch(`${url}/agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function parseEvents(body: string): BaseEvent[] {
  return body.trim().split("\n\n").map((frame) => {
    expect(frame.startsWith("data: ")).toBe(true);
    return EventSchema.parse(JSON.parse(frame.slice(6)));
  });
}

describe("AG-UI HTTP endpoint", () => {
  it("streams valid lifecycle and text events", async () => {
    const runtime: AgentRuntime = {
      async run(_input, emit) {
        emit({ type: EventType.TEXT_MESSAGE_START, messageId: "answer-1", role: "assistant" });
        emit({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: "answer-1", delta: "Hel" });
        emit({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: "answer-1", delta: "lo" });
        emit({ type: EventType.TEXT_MESSAGE_END, messageId: "answer-1" });
      },
      async close() {},
    };
    const url = await start(runtime);
    const response = await post(url, input);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const events = parseEvents(await response.text());
    expect(events.map((event) => event.type)).toEqual([
      "RUN_STARTED", "TEXT_MESSAGE_START", "TEXT_MESSAGE_CONTENT",
      "TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_END", "RUN_FINISHED",
    ]);
    expect(events[0]).toMatchObject({ threadId: "thread-1", runId: "run-1" });
  });

  it("returns validation failures before opening the event stream", async () => {
    const runtime: AgentRuntime = { async run() {}, async close() {} };
    const url = await start(runtime);
    const response = await post(url, { ...input, messages: [] });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "The last message must be a non-empty text user message." });
  });

  it("ends a failed run with RUN_ERROR", async () => {
    const runtime: AgentRuntime = {
      async run() { throw new Error("Model failed."); },
      async close() {},
    };
    const url = await start(runtime);
    const events = parseEvents(await (await post(url, input)).text());

    expect(events.map((event) => event.type)).toEqual(["RUN_STARTED", "RUN_ERROR"]);
    expect(events[1]).toMatchObject({ message: "Model failed." });
  });
});
