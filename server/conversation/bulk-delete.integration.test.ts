import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";
import type { RunAgentInput } from "@ag-ui/client";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, test } from "vitest";
import type { RunStatus } from "../../shared/run-status";
import {
  createIntegrationDatabase,
  type IntegrationDatabase,
} from "../tests/database";

let testDatabase: IntegrationDatabase;
let database: typeof import("../db/database");
let schema: typeof import("../db/schema");
let runStore: typeof import("./run-store");
let app: (typeof import("../app"))["app"];

beforeAll(async () => {
  testDatabase = await createIntegrationDatabase();
  process.env.APP_DATABASE_URL = testDatabase.url;
  database = await import("../db/database");
  schema = await import("../db/schema");
  runStore = await import("./run-store");
  ({ app } = await import("../app"));
  await database.migrateServer();
  // Upstream-owned records are fixtures, never server migrations.
  await database.db.execute(sql`
    CREATE TABLE workflow_outputs (
      id text PRIMARY KEY, thread_id text NOT NULL, payload jsonb NOT NULL
    )
  `);
  await database.db.execute(sql`
    CREATE TABLE checkpoints (
      thread_id text NOT NULL, checkpoint_id text NOT NULL,
      checkpoint jsonb NOT NULL, PRIMARY KEY (thread_id, checkpoint_id)
    )
  `);
});

beforeEach(async () => {
  await database.db.execute(sql`
    TRUNCATE external_task_events, external_tasks,
      conversation_messages, conversation_runs, conversations,
      workflow_outputs, checkpoints
  `);
});

afterAll(async () => {
  try {
    await database?.db.$client.end();
  } finally {
    await testDatabase?.dispose();
  }
});

async function clearConversations() {
  return app.request("/conversations", { method: "DELETE" });
}

function inputFor(threadId: string, turn = 1): RunAgentInput {
  return {
    threadId,
    runId: `${threadId}-run-${turn}`,
    messages: [
      { id: `${threadId}-message-${turn}`, role: "user", content: "Question" },
    ],
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

async function seedRun(threadId: string, status: RunStatus) {
  const input = inputFor(threadId);

  await admit(input);
  await database.db
    .update(schema.conversationRuns)
    .set({ status, checkpointSynced: true })
    .where(eq(schema.conversationRuns.aguiRunId, input.runId));

  return input;
}

async function waitForBlockedQuery(fragment: string) {
  for (let attempt = 0; attempt < 500; attempt++) {
    const result = await database.db.$client.query<{ blocked: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_stat_activity
         WHERE datname = current_database() AND pid <> pg_backend_pid()
           AND wait_event_type = 'Lock' AND query LIKE $1
       ) AS blocked`,
      [`%${fragment}%`],
    );

    if (result.rows[0]?.blocked) {
      return;
    }

    await setTimeout(10);
  }

  assert.fail(`Query did not wait for its lock: ${fragment}`);
}

test("clear tombstones every page and preserves messages, runs, outputs and checkpoints", async () => {
  const statuses = ["completed", "failed", "interrupted"] as const;
  const history = Array.from({ length: 35 }, (_, index) =>
    inputFor(`conversation-${index}`),
  );

  await database.db.transaction(async (tx) => {
    await tx.insert(schema.conversations).values(
      history.map((input) => ({
        threadId: input.threadId,
        title: "Question",
        nextSubmitSeq: 2,
      })),
    );
    await tx.insert(schema.conversationRuns).values(
      history.map((input, index) => ({
        aguiRunId: input.runId,
        threadId: input.threadId,
        messageId: input.messages[0]!.id,
        submitSeq: 1,
        request: input,
        status: statuses[index % statuses.length]!,
        checkpointSynced: true,
      })),
    );
    await tx.insert(schema.conversationMessages).values(
      history.map((input) => ({
        threadId: input.threadId,
        messageId: input.messages[0]!.id,
        submitSeq: 1,
        message: input.messages[0]!,
      })),
    );
  });

  await database.db.insert(schema.conversations).values({ threadId: "empty" });
  await database.db.execute(sql`
    INSERT INTO workflow_outputs VALUES ('output', 'conversation-0', '{"messages":[]}')
  `);
  await database.db.execute(sql`
    INSERT INTO checkpoints VALUES ('conversation-0', 'checkpoint', '{"value":"saved"}')
  `);
  const recordsBefore = await Promise.all([
    database.db.select().from(schema.conversationMessages),
    database.db.select().from(schema.conversationRuns),
    database.db.$client.query("SELECT * FROM workflow_outputs"),
    database.db.$client.query("SELECT * FROM checkpoints"),
  ]);
  const response = await clearConversations();

  assert.equal(response.status, 204);
  assert.equal(await response.text(), "");
  const rows = await database.db.select().from(schema.conversations);

  assert.equal(rows.length, 36);
  assert.ok(rows.every((row) => row.deletedAt));
  assert.deepEqual(await (await app.request("/conversations")).json(), {
    conversations: [],
    nextCursor: null,
  });
  assert.equal(
    (await app.request("/conversations/conversation-0")).status,
    404,
  );
  await assert.rejects(
    admit(inputFor("conversation-0", 2)),
    /Conversation not found/,
  );
  const recordsAfter = await Promise.all([
    database.db.select().from(schema.conversationMessages),
    database.db.select().from(schema.conversationRuns),
    database.db.$client.query("SELECT * FROM workflow_outputs"),
    database.db.$client.query("SELECT * FROM checkpoints"),
  ]);

  assert.deepEqual(recordsAfter[0], recordsBefore[0]);
  assert.deepEqual(recordsAfter[1], recordsBefore[1]);
  assert.deepEqual(recordsAfter[2].rows, recordsBefore[2].rows);
  assert.deepEqual(recordsAfter[3].rows, recordsBefore[3].rows);
});

test.each([
  "prepared",
  "dispatching",
  "running",
  "submission_unknown",
] as const)(
  "clear rejects latest %s without deleting any conversation",
  async (status) => {
    await seedRun("a-completed", "completed");
    await seedRun("z-blocked", status);
    const before = await database.db.select().from(schema.conversations);
    const response = await clearConversations();

    assert.equal(response.status, 409);
    const body = (await response.json()) as { error: unknown };

    assert.equal(typeof body.error, "string");
    assert.ok(body.error);
    assert.deepEqual(
      await database.db.select().from(schema.conversations),
      before,
    );
  },
);

test("clear checks the latest run and leaves existing tombstones unchanged", async () => {
  await seedRun("older-unknown", "submission_unknown");
  await database.db.insert(schema.conversationRuns).values({
    threadId: "older-unknown",
    aguiRunId: "newest-completed",
    messageId: "newest-message",
    submitSeq: 2,
    status: "completed",
    request: inputFor("older-unknown", 2),
  });
  await seedRun("already-deleted", "running");
  const deletedAt = new Date("2020-01-01T00:00:00Z");

  await database.db
    .update(schema.conversations)
    .set({ deletedAt })
    .where(eq(schema.conversations.threadId, "already-deleted"));
  assert.equal((await clearConversations()).status, 204);
  const [existing] = await database.db
    .select()
    .from(schema.conversations)
    .where(eq(schema.conversations.threadId, "already-deleted"));

  assert.deepEqual(existing?.deletedAt, deletedAt);
});

test("clear succeeds for empty and repeated requests", async () => {
  assert.equal((await clearConversations()).status, 204);
  await database.db.insert(schema.conversations).values({ threadId: "empty" });
  assert.equal((await clearConversations()).status, 204);
  const [first] = await database.db.select().from(schema.conversations);

  assert.equal((await clearConversations()).status, 204);
  assert.deepEqual(await database.db.select().from(schema.conversations), [
    first,
  ]);
});

test("clear handles histories beyond PostgreSQL's bind parameter limit", async () => {
  await database.db.execute(sql`
    INSERT INTO conversations (thread_id)
    SELECT 'large-history-' || index FROM generate_series(1, 65536) AS index
  `);
  const response = await clearConversations();

  assert.equal(response.status, 204);
  const counts = await database.db.$client.query<{
    total: number;
    deleted: number;
  }>(`
    SELECT count(*)::integer AS total,
      count(deleted_at)::integer AS deleted
    FROM conversations
  `);

  assert.deepEqual(counts.rows, [{ total: 65536, deleted: 65536 }]);
});

test("clear waits for admission and checks status after acquiring conversation locks", async () => {
  await seedRun("existing", "completed");
  const gate = await database.db.$client.connect();

  await gate.query("SELECT pg_advisory_lock(12345)");
  await database.db.$client.query(`
    CREATE FUNCTION pause_admission() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      PERFORM pg_advisory_xact_lock(12345);
      RETURN NEW;
    END $$
  `);
  await database.db.$client.query(`
    CREATE TRIGGER pause_admission BEFORE INSERT ON conversation_runs
    FOR EACH ROW EXECUTE FUNCTION pause_admission()
  `);
  let admission: Promise<unknown> | undefined;
  let deletion: Promise<Response> | undefined;

  try {
    admission = admit(inputFor("existing", 2));
    await waitForBlockedQuery('insert into "conversation_runs"');
    deletion = clearConversations();
    await waitForBlockedQuery('from "conversations"');
    await gate.query("SELECT pg_advisory_unlock(12345)");
    await admission;
    assert.equal((await deletion).status, 409);
    const [conversation] = await database.db
      .select()
      .from(schema.conversations);

    assert.equal(conversation?.deletedAt, null);
  } finally {
    await gate.query("SELECT pg_advisory_unlock_all()");
    await Promise.allSettled([admission, deletion]);
    gate.release();
    await database.db.$client.query(
      "DROP TRIGGER pause_admission ON conversation_runs",
    );
    await database.db.$client.query("DROP FUNCTION pause_admission()");
  }
});

test("clear locks in thread order, blocks admission and excludes conversations created afterward", async () => {
  // Insertion order differs from lock order to catch missing ORDER BY.
  await seedRun("z-last", "completed");
  await seedRun("a-first", "completed");
  const blocker = await database.db.$client.connect();

  await blocker.query("BEGIN");
  await blocker.query(
    "SELECT * FROM conversations WHERE thread_id = 'z-last' FOR UPDATE",
  );
  let deletion: Promise<Response> | undefined;
  let admissionRejected: Promise<void> | undefined;

  try {
    deletion = clearConversations();
    await waitForBlockedQuery('from "conversations"');
    admissionRejected = assert.rejects(
      admit(inputFor("a-first", 2)),
      /Conversation not found/,
    );
    await waitForBlockedQuery('"thread_id" = $1 for update');
    await database.db
      .insert(schema.conversations)
      .values({ threadId: "new-after-selection" });
    await blocker.query("COMMIT");
    assert.equal((await deletion).status, 204);
    await admissionRejected;
    const [newConversation] = await database.db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.threadId, "new-after-selection"));

    assert.equal(newConversation?.deletedAt, null);
  } finally {
    await blocker.query("ROLLBACK");
    await Promise.allSettled([admissionRejected, deletion]);
    blocker.release();
  }
});
