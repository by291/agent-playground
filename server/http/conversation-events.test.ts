import assert from "node:assert/strict";
import { Hono } from "hono";
import { afterEach, beforeEach, test, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  clients: [] as import("node:events").EventEmitter[],
  ended: new Set<import("node:events").EventEmitter>(),
}));

vi.mock("pg", async () => {
  const { EventEmitter } = await import("node:events");

  class Client extends EventEmitter {
    constructor() {
      super();
      fixture.clients.push(this);
    }

    connect() {
      return Promise.resolve();
    }

    query() {
      return Promise.resolve();
    }

    end() {
      fixture.ended.add(this);

      return Promise.resolve();
    }
  }

  return { default: { Client } };
});

let app: Hono;
let closeConversationChanges: () => Promise<void>;
let streamConversationChanges: typeof import("./conversation-events").streamConversationChanges;
const readers = new Set<ReadableStreamDefaultReader<Uint8Array>>();

beforeEach(async () => {
  vi.resetModules();
  ({ streamConversationChanges } = await import("./conversation-events"));
  ({ closeConversationChanges } =
    await import("../conversation/change-subscription"));
  app = new Hono();
  app.get("/events/:threadId", (context) =>
    streamConversationChanges(context, context.req.param("threadId")),
  );
});

async function subscribe(threadId: string) {
  const response = await app.request(`/events/${threadId}`);
  const reader = response.body!.getReader();

  readers.add(reader);
  assert.match(await read(reader), /event: ready/);

  return reader;
}

async function read(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const result = await reader.read();

  return new TextDecoder().decode(result.value);
}

afterEach(async () => {
  await closeConversationChanges();
  await Promise.all([...readers].map((reader) => reader.cancel()));
  readers.clear();
  await vi.waitFor(() =>
    assert.equal(fixture.ended.size, fixture.clients.length),
  );
  fixture.clients.length = 0;
  fixture.ended.clear();
});

test("tabs share one database listener and receive only their thread changes", async () => {
  const first = await subscribe("first");
  const second = await subscribe("second");

  assert.equal(fixture.clients.length, 1);
  fixture.clients[0]!.emit("notification", { payload: "first" });
  assert.match(await read(first), /event: changed/);
  await first.cancel();
  assert.equal(fixture.ended.size, 0);
  fixture.clients[0]!.emit("notification", { payload: "second" });
  assert.match(await read(second), /event: changed/);
  await second.cancel();
  await vi.waitFor(() => assert.equal(fixture.ended.size, 1));
});

test("database failure closes live streams and a new subscription becomes ready", async () => {
  const first = await subscribe("first");
  const second = await subscribe("second");

  fixture.clients[0]!.emit("error", new Error("Database connection lost"));
  assert.equal((await first.read()).done, true);
  assert.equal((await second.read()).done, true);
  const reconnected = await subscribe("first");

  assert.equal(fixture.clients.length, 2);
  fixture.clients[1]!.emit("notification", { payload: "first" });
  assert.match(await read(reconnected), /event: changed/);
});

test("a route finishing after shutdown cannot reopen the database listener", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  app.get("/delayed", async (context) => {
    await gate;

    return streamConversationChanges(context, "late");
  });
  const existing = await subscribe("first");
  const response = app.request("/delayed");

  await closeConversationChanges();
  assert.equal((await existing.read()).done, true);
  release();
  const late = (await response).body!.getReader();

  readers.add(late);
  assert.equal((await late.read()).done, true);
  assert.equal(fixture.clients.length, 1);
});

test("an already aborted request does not create a database listener", async () => {
  const controller = new AbortController();

  controller.abort();
  const response = await app.fetch(
    new Request("http://localhost/events/cancelled", {
      signal: controller.signal,
    }),
  );
  const reader = response.body!.getReader();

  readers.add(reader);
  assert.equal((await reader.read()).done, true);
  assert.equal(fixture.clients.length, 0);
});
