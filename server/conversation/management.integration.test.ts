import { afterAll, beforeAll, test } from "vitest";
import assert from "node:assert/strict";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { eq, sql } from "drizzle-orm";
import type { RunAgentInput } from "@ag-ui/client";
import { conversationPageSchema } from "../../shared/conversation";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";

let postgres: StartedPostgreSqlContainer;
let database: typeof import("../db/database");
let schema: typeof import("../db/schema");
let runStore: typeof import("./run-store");
let app: (typeof import("../app"))["app"];

beforeAll(async () => {
  postgres = await new PostgreSqlContainer("postgres:18-alpine").start();
  process.env.APP_DATABASE_URL = postgres.getConnectionUri();
  database = await import("../db/database");
  schema = await import("../db/schema");
  runStore = await import("./run-store");
  ({ app } = await import("../app"));
  const legacyMigrations = await mkdtemp(
    join(tmpdir(), "conversation-migration-"),
  );

  try {
    await cp(new URL("../drizzle", import.meta.url), legacyMigrations, {
      recursive: true,
    });
    const journalPath = join(legacyMigrations, "meta", "_journal.json");
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
      entries: { idx: number }[];
    };

    // Reproduce a server that already applied the initial management migration.
    journal.entries = journal.entries.filter((entry) => entry.idx < 5);
    await writeFile(journalPath, JSON.stringify(journal));
    await migrate(database.db, { migrationsFolder: legacyMigrations });
    await database.db.execute(sql`
      INSERT INTO conversations (thread_id, created_at, next_submit_seq)
      VALUES ('legacy', '2020-01-01T00:00:00Z', 2), ('legacy-unicode', '2020-01-01T00:00:00Z', 2)
    `);
    await database.db.execute(sql`
      INSERT INTO conversation_messages (thread_id, message_id, submit_seq, message)
      VALUES ('legacy', 'legacy-message', 1, '{"id":"legacy-message","role":"user","content":"  Old   discussion  "}'),
      ('legacy-unicode', 'legacy-unicode-message', 1, ${JSON.stringify({ id: "legacy-unicode-message", role: "user", content: "😀".repeat(110) })}::jsonb)
    `);
    await database.db.execute(sql`
      INSERT INTO conversation_runs (thread_id, agui_run_id, message_id, submit_seq, request, status, created_at)
      VALUES ('legacy', 'legacy-run', 'legacy-message', 1, '{}', 'completed', '2021-01-01T00:00:00.123456Z')
    `);
    await database.db.execute(sql`
      INSERT INTO conversations (thread_id, title) VALUES ('custom-title', 'My saved title'), ('empty-history', 'Untitled conversation')
    `);
    await database.db.execute(sql`
      INSERT INTO conversation_messages (thread_id, message_id, submit_seq, message)
      VALUES ('custom-title', 'custom-message', 1, '{"id":"custom-message","role":"user","content":"Do not replace my title"}'),
      ('empty-history', 'blank-message', 1, '{"id":"blank-message","role":"user","content":"   "}'),
      ('empty-history', 'useful-message', 2, '{"id":"useful-message","role":"user","content":"A usable title"}')
    `);
  } finally {
    await rm(legacyMigrations, { recursive: true, force: true });
  }

  await database.migrateServer();
});

afterAll(async () => {
  try {
    await database?.db.$client.end();
  } finally {
    await postgres?.stop();
  }
});

function inputFor(threadId: string, content: string): RunAgentInput {
  return {
    threadId,
    runId: `${threadId}-run`,
    messages: [{ id: `${threadId}-message`, role: "user", content }],
    tools: [],
    context: [],
    state: {},
  };
}

function admit(input: RunAgentInput) {
  return runStore.admitRun({
    threadId: input.threadId,
    runId: input.runId,
    messageId: input.messages[0]!.id,
    request: input,
    userMessage: input.messages[0]!,
    isResume: false,
  });
}

function rename(threadId: string, title: unknown) {
  return app.request(`/conversations/${threadId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
}

test("the migration preserves old history and backfills titles and recent activity", async () => {
  const page = conversationPageSchema.parse(
    await (await app.request("/conversations")).json(),
  );
  const legacy = page.conversations.find(
    (entry) => entry.threadId === "legacy",
  );

  assert.equal(legacy?.title, "Old discussion");
  assert.equal(legacy?.createdAt, "2020-01-01T00:00:00.000Z");
  assert.equal(legacy?.updatedAt, "2021-01-01T00:00:00.123Z");
  assert.equal(
    page.conversations.find((entry) => entry.threadId === "legacy-unicode")
      ?.title,
    "😀".repeat(100),
  );
  assert.equal(
    page.conversations.find((entry) => entry.threadId === "custom-title")
      ?.title,
    "My saved title",
  );
  assert.equal(
    page.conversations.find((entry) => entry.threadId === "empty-history")
      ?.title,
    "A usable title",
  );
});

test("admission names conversations and rename persists across later turns", async () => {
  const input = inputFor("named", "  Investigate\n  workflow recovery  ");

  await admit(input);
  const list = await app.request("/conversations");
  const body = conversationPageSchema.parse(await list.json());
  const entry = body.conversations.find(
    (row: { threadId: string }) => row.threadId === "named",
  );

  assert.equal(entry?.title, "Investigate workflow recovery");
  assert.equal(entry?.status, "prepared");
  assert.ok(entry?.updatedAt);
  const renamed = await rename("named", "  Recovery notes  ");

  assert.equal(renamed.status, 200);
  assert.deepEqual(await renamed.json(), {
    threadId: "named",
    title: "Recovery notes",
  });
  await database.db
    .update(schema.conversationRuns)
    .set({ status: "completed", checkpointSynced: true })
    .where(eq(schema.conversationRuns.aguiRunId, input.runId));
  const next = inputFor("named", "A second question");

  next.runId = "named-second-run";
  next.messages[0]!.id = "named-second-message";
  await admit(next);
  const [saved] = await database.db
    .select()
    .from(schema.conversations)
    .where(eq(schema.conversations.threadId, "named"));

  assert.equal(saved?.title, "Recovery notes");
});

test("management validates titles, cursors and missing conversations", async () => {
  for (const title of ["", "   ", "x".repeat(101), 42]) {
    assert.equal((await rename("named", title)).status, 400);
  }

  assert.equal((await rename("missing", "Name")).status, 404);
  assert.equal((await app.request("/conversations?cursor=broken")).status, 400);
  assert.equal(
    (await app.request("/conversations/missing", { method: "DELETE" })).status,
    404,
  );
});

test("deletion rejects unfinished runs and tombstones completed or paused conversations", async () => {
  for (const status of [
    "prepared",
    "dispatching",
    "running",
    "submission_unknown",
  ] as const) {
    const threadId = `blocked-${status}`;
    const input = inputFor(threadId, "Still working");

    await admit(input);
    await database.db
      .update(schema.conversationRuns)
      .set({ status })
      .where(eq(schema.conversationRuns.aguiRunId, input.runId));
    assert.equal(
      (await app.request(`/conversations/${threadId}`, { method: "DELETE" }))
        .status,
      409,
    );
  }

  for (const status of ["completed", "failed", "interrupted"] as const) {
    const threadId = `deleted-${status}`;
    const input = inputFor(threadId, "Remove this conversation");

    await admit(input);
    await database.db
      .update(schema.conversationRuns)
      .set({ status })
      .where(eq(schema.conversationRuns.aguiRunId, input.runId));
    assert.equal(
      (await app.request(`/conversations/${threadId}`, { method: "DELETE" }))
        .status,
      204,
    );
    assert.equal((await app.request(`/conversations/${threadId}`)).status, 404);
    assert.equal((await rename(threadId, "Bring it back")).status, 404);
    await assert.rejects(admit(input), /Conversation not found/);
    const list = conversationPageSchema.parse(
      await (await app.request("/conversations")).json(),
    );

    assert.ok(
      !list.conversations.some(
        (row: { threadId: string }) => row.threadId === threadId,
      ),
    );
  }
});

test("pagination reaches old conversations once even when timestamps tie", async () => {
  const timestamp = new Date("2020-01-01T00:00:00.000Z");

  await database.db.insert(schema.conversations).values(
    Array.from({ length: 65 }, (_, index) => ({
      threadId: `page-${String(index).padStart(3, "0")}`,
      createdAt: timestamp,
    })),
  );
  await database.db.execute(sql`
    UPDATE conversations SET updated_at = ${timestamp} WHERE thread_id LIKE 'page-%'
  `);
  const ids: string[] = [];
  let cursor: string | null = null;

  do {
    const response = await app.request(
      `/conversations${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    const page = conversationPageSchema.parse(await response.json());

    assert.equal(response.status, 200);
    assert.ok(page.conversations.length <= 30);
    ids.push(
      ...page.conversations.map((row: { threadId: string }) => row.threadId),
    );
    cursor = page.nextCursor;
  } while (cursor);

  assert.equal(ids.filter((id) => id.startsWith("page-")).length, 65);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids.filter((id) => id.startsWith("page-")).slice(0, 2), [
    "page-064",
    "page-063",
  ]);
});

test("titles count Unicode characters consistently for new and renamed conversations", async () => {
  const input = inputFor("unicode", "😀".repeat(110));

  await admit(input);
  const page = conversationPageSchema.parse(
    await (await app.request("/conversations")).json(),
  );

  assert.equal(
    page.conversations.find((entry) => entry.threadId === "unicode")?.title,
    "😀".repeat(100),
  );
  assert.equal((await rename("unicode", "😀".repeat(100))).status, 200);
  assert.equal((await rename("unicode", "😀".repeat(101))).status, 400);
});

test("concurrent deletion and admission cannot both succeed", async () => {
  const initial = inputFor("race", "First turn");

  await admit(initial);
  await database.db
    .update(schema.conversationRuns)
    .set({ status: "completed", checkpointSynced: true })
    .where(eq(schema.conversationRuns.aguiRunId, initial.runId));
  const next = inputFor("race", "Second turn");

  next.runId = "race-next";
  next.messages[0]!.id = "race-next-message";
  const [deletion, admission] = await Promise.all([
    app.request("/conversations/race", { method: "DELETE" }),
    admit(next).then(
      () => true,
      () => false,
    ),
  ]);

  if (deletion.status === 204) {
    assert.equal(admission, false);
  } else {
    assert.equal(deletion.status, 409);
    assert.equal(admission, true);
  }
});
