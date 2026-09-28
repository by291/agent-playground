import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "node:http";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { eq, sql } from "drizzle-orm";
import type { RunAgentInput } from "@ag-ui/client";

let postgres: StartedPostgreSqlContainer;
let runStore: typeof import("./run-store");
let recovery: typeof import("./recovery");
let database: typeof import("../db/database");
let schema: typeof import("../db/schema");
let app: (typeof import("../app"))["app"];
let unavailable = false;
let stateReads = 0;
let listedRuns: unknown[] = [];
let compactedCheckpoint = false;
const contextUsage = {
  model: "deepseek-flash",
  usedTokens: 1200,
  contextWindow: 1000000,
  triggerTokens: 800000,
  breakdown: {
    system: 100,
    tools: 200,
    conversation: 300,
    toolResults: 100,
    summary: 500,
  },
  lastInputTokens: 1600,
  compactions: 1,
  lastCompaction: { beforeTokens: 810000, afterTokens: 1200 },
  revision: 4,
};
const upstream = createServer((request, response) => {
  response.writeHead(unavailable ? 503 : 200, {
    "Content-Type": "application/json",
  });

  if (unavailable) {
    response.end(JSON.stringify({ detail: "Service unavailable" }));
  } else if (request.url?.endsWith("/state")) {
    stateReads += 1;
    response.end(
      JSON.stringify({
        values: {
          ...(compactedCheckpoint
            ? {
                context_usage: contextUsage,
                response_messages: [
                  {
                    id: "earlier-reply",
                    type: "ai",
                    content: "Earlier response from this run",
                  },
                  {
                    id: "latest-reply",
                    type: "ai",
                    content: "Latest response",
                  },
                ],
              }
            : {}),
          messages: [
            { id: "checkpoint-reply", type: "ai", content: "Saved reply" },
            {
              id: "checkpoint-followup",
              type: "ai",
              content: "Follow-up reply",
            },
          ],
        },
        tasks: [],
        next: [],
        checkpoint: {
          thread_id: "checkpoint",
          checkpoint_id: "checkpoint-id",
          checkpoint_ns: "",
        },
        metadata: {},
        created_at: null,
        parent_checkpoint: null,
      }),
    );
  } else if (request.url?.includes("/runs/")) {
    response.end(
      JSON.stringify({
        run_id: "upstream-run",
        thread_id: "thread",
        status: "pending",
        metadata: {},
      }),
    );
  } else {
    response.end(JSON.stringify(listedRuns));
  }
});

before(async () => {
  postgres = await new PostgreSqlContainer("postgres:18-alpine").start();
  process.env.APP_DATABASE_URL = postgres.getConnectionUri();
  await new Promise<void>((resolve) =>
    upstream.listen(0, "127.0.0.1", resolve),
  );
  const address = upstream.address();

  assert.ok(address && typeof address === "object");
  process.env.AEGRA_URL = `http://127.0.0.1:${address.port}`;
  database = await import("../db/database");
  schema = await import("../db/schema");
  runStore = await import("./run-store");
  recovery = await import("./recovery");
  ({ app } = await import("../app"));
  await database.migrateServer();
  // Match the Python-owned read contract without adding it to server migrations.
  await database.db.execute(sql`
    CREATE TABLE workflow_outputs (
      id text PRIMARY KEY, thread_id text NOT NULL, agui_run_id text,
      workflow_call_id text NOT NULL, step_id text NOT NULL, step_seq integer,
      output_seq bigint, kind text, version integer, payload jsonb,
      created_at timestamptz DEFAULT now()
    )
  `);
});

after(async () => {
  upstream.closeAllConnections();
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
  await database?.db.$client.end();
  await postgres?.stop();
});

function inputFor(threadId: string): RunAgentInput {
  return {
    threadId,
    runId: `${threadId}-run`,
    messages: [{ id: `${threadId}-message`, role: "user", content: "Hello" }],
    tools: [],
    context: [],
    state: {},
  };
}

async function admit(threadId: string) {
  const input = inputFor(threadId);
  const admitted = await runStore.admitRun({
    threadId,
    runId: input.runId,
    messageId: input.messages[0]!.id,
    request: input,
    userMessage: input.messages[0]!,
    isResume: false,
  });

  await runStore.claimPrepared(input.runId);

  return { ...admitted.row, status: "dispatching" as const };
}

async function pauseForReview(threadId: string) {
  const run = await admit(threadId);
  const interrupt = {
    id: `${threadId}-interrupt`,
    reason: "Review plan",
    metadata: {
      langgraph: { raw: { workflowCallId: `${threadId}-workflow` } },
    },
  };

  await database.db
    .update(schema.conversationRuns)
    .set({
      status: "interrupted",
      checkpointSynced: true,
      interrupts: [interrupt],
    })
    .where(eq(schema.conversationRuns.aguiRunId, run.aguiRunId));
  await database.db.execute(sql`
    INSERT INTO workflow_outputs (id, thread_id, workflow_call_id, step_id)
    VALUES (${threadId}, ${threadId}, ${`${threadId}-workflow`}, 'review')
  `);
  const input: RunAgentInput = {
    ...inputFor(threadId),
    runId: `${threadId}-resume`,
    resume: [
      {
        interruptId: interrupt.id,
        status: "resolved",
        payload: { decision: "approve" },
      },
    ],
  };

  return { run, input };
}

void test("a late creation callback preserves an already completed run", async () => {
  const row = await admit("late-callback");

  await runStore.recordAegraRun(row.aguiRunId, "aegra-run");
  await database.db
    .update(schema.conversationRuns)
    .set({ status: "completed" })
    .where(eq(schema.conversationRuns.aguiRunId, row.aguiRunId));
  await runStore.recordAegraRun(row.aguiRunId, "aegra-run");
  const [saved] = await database.db
    .select()
    .from(schema.conversationRuns)
    .where(eq(schema.conversationRuns.aguiRunId, row.aguiRunId));

  assert.equal(saved?.status, "completed");
});

void test("a stale missing-mapping lookup cannot overwrite a successful creation callback", async () => {
  const stale = await admit("stale-lookup");

  await runStore.recordAegraRun(stale.aguiRunId, "confirmed-run");
  const recovered = await recovery.reconcileRun(stale);

  assert.equal(recovered.status, "running");
  assert.equal(recovered.aegraRunId, "confirmed-run");
  const [saved] = await database.db
    .select()
    .from(schema.conversationRuns)
    .where(eq(schema.conversationRuns.aguiRunId, stale.aguiRunId));

  assert.equal(saved?.status, "running");
});

void test("an unavailable upstream is reported as unavailable rather than an admission conflict", async () => {
  const row = await admit("unavailable-upstream");

  await runStore.recordAegraRun(row.aguiRunId, "upstream-run");
  unavailable = true;

  try {
    const next = {
      ...inputFor(row.threadId),
      runId: "next-run",
      messages: [
        { id: "next-message", role: "user" as const, content: "Next" },
      ],
    };
    const response = await app.request("/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    });

    assert.equal(response.status, 503);
  } finally {
    unavailable = false;
  }
});

void test("an older running observation cannot reopen a completed run", async () => {
  const admitted = await admit("stale-terminal");

  await runStore.recordAegraRun(admitted.aguiRunId, "upstream-run");
  const stale = await runStore.latestRun(admitted.threadId);

  assert.ok(stale);
  await database.db
    .update(schema.conversationRuns)
    .set({ status: "completed" })
    .where(eq(schema.conversationRuns.aguiRunId, stale.aguiRunId));
  const reconciled = await recovery.reconcileRun(stale);

  assert.equal(reconciled.status, "completed");
});

void test("a completed checkpoint is synchronized once and only adds missing messages", async () => {
  const { synchronizeConversation } = await import("./checkpoint-sync");
  const run = await admit("checkpoint-once");

  await runStore.recordAegraRun(run.aguiRunId, "upstream-run");
  await database.db
    .update(schema.conversationRuns)
    .set({ status: "completed" })
    .where(eq(schema.conversationRuns.aguiRunId, run.aguiRunId));
  const beforeReads = stateReads;

  await synchronizeConversation(run.threadId);
  await synchronizeConversation(run.threadId);
  assert.equal(stateReads - beforeReads, 1);
  const current = await runStore.latestRun(run.threadId);

  assert.equal(current?.checkpointSynced, true);
  const messages = await database.db
    .select()
    .from(schema.conversationMessages)
    .where(eq(schema.conversationMessages.threadId, run.threadId));

  assert.equal(messages.length, 3);
  assert.equal(
    messages.find((message) => message.messageId === "checkpoint-reply")
      ?.message.content,
    "Saved reply",
  );
  // Timestamp ties (or clock changes) cannot reorder one checkpoint's messages.
  await database.db
    .update(schema.conversationMessages)
    .set({ createdAt: new Date("2030-01-01") })
    .where(eq(schema.conversationMessages.messageId, "checkpoint-reply"));
  const { conversationSnapshot } = await import("./conversation-snapshot");
  const snapshot = await conversationSnapshot(run.threadId);

  assert.deepEqual(
    snapshot?.messages.map((message) => message.id),
    [`${run.threadId}-message`, "checkpoint-reply", "checkpoint-followup"],
  );
});

void test("a compacted checkpoint recovers usage and replies removed from model history", async () => {
  compactedCheckpoint = true;

  try {
    const { synchronizeConversation } = await import("./checkpoint-sync");
    const { conversationSnapshot } = await import("./conversation-snapshot");
    const run = await admit("compacted-checkpoint");

    await runStore.recordAegraRun(run.aguiRunId, "upstream-run");
    await database.db
      .update(schema.conversationRuns)
      .set({ status: "completed" })
      .where(eq(schema.conversationRuns.aguiRunId, run.aguiRunId));
    await synchronizeConversation(run.threadId);
    const beforeReads = stateReads;
    const snapshot = await conversationSnapshot(run.threadId);

    assert.deepEqual(snapshot?.contextUsage, contextUsage);
    assert.deepEqual(
      snapshot?.messages.map((message) => message.id),
      [`${run.threadId}-message`, "earlier-reply", "latest-reply"],
    );
    await synchronizeConversation(run.threadId);
    assert.equal(stateReads, beforeReads);
  } finally {
    compactedCheckpoint = false;
  }
});

void test("a resumed review no longer blocks the next ordinary message", async () => {
  const { run: interrupted, input: resume } =
    await pauseForReview("resumed-review");

  await runStore.admitRun({
    threadId: resume.threadId,
    runId: resume.runId,
    messageId: resume.runId,
    request: resume,
    userMessage: null,
    isResume: true,
  });
  await database.db
    .update(schema.conversationRuns)
    .set({ status: "completed" })
    .where(eq(schema.conversationRuns.aguiRunId, resume.runId));
  const next = {
    ...inputFor(interrupted.threadId),
    runId: "after-review",
    messages: [
      { id: "after-review-message", role: "user" as const, content: "Next" },
    ],
  };
  const admitted = await runStore.admitRun({
    threadId: next.threadId,
    runId: next.runId,
    messageId: next.messages[0]!.id,
    request: next,
    userMessage: next.messages[0]!,
    isResume: false,
  });

  assert.equal(admitted.row.submitSeq, 3);
});

void test("an identical prepared review submission can be claimed after restart", async () => {
  const { prepareConversationRun } = await import("./service");
  const { input } = await pauseForReview("prepared-review");

  await runStore.admitRun({
    threadId: input.threadId,
    runId: input.runId,
    messageId: input.runId,
    request: input,
    userMessage: null,
    isResume: true,
  });
  await prepareConversationRun(input);
  assert.equal(
    (await runStore.latestRun(input.threadId))?.status,
    "dispatching",
  );
});

void test("an unknown submission can recover its newest confirmed native mapping", async () => {
  const { synchronizeConversation } = await import("./checkpoint-sync");
  const run = await admit("unknown-mapping");

  await database.db
    .update(schema.conversationRuns)
    .set({ status: "submission_unknown" })
    .where(eq(schema.conversationRuns.aguiRunId, run.aguiRunId));
  listedRuns = [
    {
      run_id: "upstream-run",
      config: { metadata: { agui_run_id: run.aguiRunId } },
    },
  ];

  try {
    await synchronizeConversation(run.threadId);
    const saved = await runStore.latestRun(run.threadId);

    assert.equal(saved?.aegraRunId, "upstream-run");
    assert.equal(saved?.status, "running");
  } finally {
    listedRuns = [];
  }
});
