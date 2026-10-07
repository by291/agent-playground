import { test, beforeAll, afterAll, vi } from "vitest";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { eq, sql } from "drizzle-orm";
import type { RunAgentInput } from "@ag-ui/client";
import {
  createIntegrationDatabase,
  type IntegrationDatabase,
} from "../tests/database";

vi.mock("../agent/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("../agent/client")>();
  const { Client } = await import("@langchain/langgraph-sdk");

  return {
    ...original,
    // These cases verify recovery responses, rather than SDK retry backoff.
    aegra: new Client({
      apiUrl: original.aegraUrl,
      onRequest: original.prepareAegraRequest,
      callerOptions: { maxRetries: 0 },
    }),
  };
});

let testDatabase: IntegrationDatabase;
let runStore: typeof import("./run-store");
let recovery: typeof import("./recovery");
let database: typeof import("../db/database");
let schema: typeof import("../db/schema");
let app: (typeof import("../app"))["app"];
let unavailable = false;
let stateReads = 0;
let listedRuns: unknown[] = [];
let compactedCheckpoint = false;
let toolCheckpoint = false;
let reasoningCheckpoint = false;
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
  } else if (request.url === "/agent-info") {
    response.end(JSON.stringify({ model: "test-model" }));
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
          ...(toolCheckpoint
            ? {
                response_messages: [
                  {
                    id: "tool-request",
                    type: "ai",
                    content: "I'll check.",
                    tool_calls: [
                      { id: "clock", name: "get_current_time", args: {} },
                    ],
                  },
                  {
                    id: "tool-result",
                    type: "tool",
                    tool_call_id: "clock",
                    content: "Clock unavailable",
                    status: "error",
                  },
                  {
                    id: "tool-answer",
                    type: "ai",
                    content: "The clock is unavailable.",
                  },
                ],
              }
            : {}),
          ...(reasoningCheckpoint
            ? {
                response_messages: [
                  {
                    id: "checkpoint-reply",
                    type: "ai",
                    content: "Saved reply",
                    additional_kwargs: { reasoning_content: "Old reasoning" },
                  },
                  {
                    id: "checkpoint-followup",
                    type: "ai",
                    content: "Follow-up reply",
                  },
                  {
                    id: "new-answer",
                    type: "ai",
                    content: "New answer",
                    additional_kwargs: { reasoning_content: "New reasoning" },
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

beforeAll(async () => {
  testDatabase = await createIntegrationDatabase();
  process.env.APP_DATABASE_URL = testDatabase.url;
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

afterAll(async () => {
  try {
    upstream.closeAllConnections();

    if (upstream.listening) {
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  } finally {
    try {
      await database?.db.$client.end();
    } finally {
      await testDatabase?.dispose();
    }
  }
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

test("generic workflow feedback validates its persisted round and cannot override acceptance", async () => {
  const { run, input } = await pauseForReview("copy-review");
  const { validateReview, workflowFeedbackMessage } = await import("./reviews");
  const [row] = await database.db
    .select()
    .from(schema.conversationRuns)
    .where(eq(schema.conversationRuns.aguiRunId, run.aguiRunId));
  const current = {
    ...row!,
    interrupts: [
      {
        id: "copy-review",
        reason: "Review copy",
        metadata: {
          langgraph: {
            raw: {
              kind: "workflow_review",
              workflowCallId: `${run.threadId}-workflow`,
              revision: 2,
              round: 4,
              outputStepId: "review:4",
              canAccept: false,
              blockedReason: "Resolve the factual issue first.",
            },
          },
        },
      },
    ],
  };

  await database.db.execute(
    sql`UPDATE workflow_outputs SET step_id = 'review:4' WHERE thread_id = ${run.threadId}`,
  );
  const payload = {
    workflowCallId: `${run.threadId}-workflow`,
    revision: 2,
    round: 4,
    action: "message",
    message: "Explain",
    messageId: "copy-feedback",
  };
  const request: RunAgentInput = {
    ...input,
    resume: [{ interruptId: "copy-review", status: "resolved", payload }],
  };

  await validateReview(request, current, database.db);
  assert.deepEqual(workflowFeedbackMessage(request), {
    id: "copy-feedback",
    role: "user",
    content: "Explain",
  });
  await assert.rejects(
    validateReview(
      {
        ...request,
        resume: [
          {
            interruptId: "copy-review",
            status: "resolved",
            payload: {
              workflowCallId: payload.workflowCallId,
              revision: 2,
              round: 4,
              action: "accept",
            },
          },
        ],
      },
      current,
      database.db,
    ),
    /Resolve the factual issue first/,
  );
  await assert.rejects(
    validateReview(
      {
        ...request,
        resume: [
          {
            interruptId: "copy-review",
            status: "resolved",
            payload: { ...payload, round: 3 },
          },
        ],
      },
      current,
      database.db,
    ),
    /no longer current/,
  );
});

test("generic workflow reply metadata is archived once before the parent reply", async () => {
  const run = await admit("copy-output");
  const { synchronizeConversation } = await import("./checkpoint-sync");
  const { conversationSnapshot } = await import("./conversation-snapshot");
  const payload = {
    messages: [],
    workflow: { reply: { id: "copy-reply", content: "Revised copy" } },
  };

  await runStore.recordAegraRun(run.aguiRunId, "upstream-run");
  await database.db.execute(sql`
    INSERT INTO workflow_outputs (id, thread_id, agui_run_id, workflow_call_id, step_id, output_seq, payload)
    VALUES ('copy-output', ${run.threadId}, ${run.aguiRunId}, 'copy-call', 'review:1', 1, ${JSON.stringify(payload)}::jsonb)
  `);
  await database.db
    .update(schema.conversationRuns)
    .set({ status: "completed" })
    .where(eq(schema.conversationRuns.aguiRunId, run.aguiRunId));
  await synchronizeConversation(run.threadId);
  await synchronizeConversation(run.threadId);
  const snapshot = await conversationSnapshot(run.threadId);

  assert.deepEqual(
    snapshot?.messages.map((message) => message.id),
    [
      `${run.threadId}-message`,
      "copy-reply",
      "checkpoint-reply",
      "checkpoint-followup",
    ],
  );
  assert.equal(snapshot?.messages[1]?.content, "Revised copy");
});

test("a late creation callback preserves an already completed run", async () => {
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

test("a stale missing-mapping lookup cannot overwrite a successful creation callback", async () => {
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

test("an unavailable upstream is reported as unavailable rather than an admission conflict", async () => {
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

test("an older running observation cannot reopen a completed run", async () => {
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

test("a completed checkpoint is synchronized once and only adds missing messages", async () => {
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

test("reasoning from an already archived answer cannot move into a later user turn", async () => {
  const { synchronizeConversation } = await import("./checkpoint-sync");
  const { conversationSnapshot } = await import("./conversation-snapshot");
  const first = await admit("historical-reasoning");

  await database.db
    .update(schema.conversationRuns)
    .set({ status: "completed" })
    .where(eq(schema.conversationRuns.aguiRunId, first.aguiRunId));
  await synchronizeConversation(first.threadId);
  const next: RunAgentInput = {
    ...inputFor(first.threadId),
    runId: "historical-reasoning-next",
    messages: [{ id: "next-question", role: "user", content: "Next question" }],
  };

  await runStore.admitRun({
    threadId: next.threadId,
    runId: next.runId,
    messageId: next.messages[0]!.id,
    request: next,
    userMessage: next.messages[0]!,
    isResume: false,
  });
  await database.db
    .update(schema.conversationRuns)
    .set({ status: "completed" })
    .where(eq(schema.conversationRuns.aguiRunId, next.runId));
  reasoningCheckpoint = true;

  try {
    await synchronizeConversation(next.threadId);
    const saved = await conversationSnapshot(next.threadId);

    assert.deepEqual(
      saved?.messages.map((message) => message.id),
      [
        `${first.threadId}-message`,
        "checkpoint-reply",
        "checkpoint-followup",
        "next-question",
        "new-answer-reasoning",
        "new-answer",
      ],
    );
    assert.equal(saved?.messages[4]?.role, "reasoning");
    assert.equal(saved?.messages[4]?.content, "New reasoning");
  } finally {
    reasoningCheckpoint = false;
  }
});

test("a compacted checkpoint recovers usage and replies removed from model history", async () => {
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

test("tool calls and errors survive archival and repeated conversation refreshes", async () => {
  toolCheckpoint = true;

  try {
    const { synchronizeConversation } = await import("./checkpoint-sync");
    const { conversationSnapshot } = await import("./conversation-snapshot");
    const run = await admit("tool-checkpoint");

    await database.db
      .update(schema.conversationRuns)
      .set({ status: "completed" })
      .where(eq(schema.conversationRuns.aguiRunId, run.aguiRunId));
    await synchronizeConversation(run.threadId);
    const saved = await conversationSnapshot(run.threadId);

    assert.deepEqual(
      saved?.messages.map((message) => message.role),
      ["user", "assistant", "tool", "assistant"],
    );
    const caller = saved?.messages[1];
    const result = saved?.messages[2];

    assert.ok(caller?.role === "assistant" && result?.role === "tool");
    assert.equal(caller.toolCalls?.[0]?.function.arguments, "{}");
    assert.equal(result.toolCallId, "clock");
    assert.equal(result.error, "Clock unavailable");
    await synchronizeConversation(run.threadId);
    assert.deepEqual(
      (await conversationSnapshot(run.threadId))?.messages,
      saved?.messages,
    );
  } finally {
    toolCheckpoint = false;
  }
});

test("a resumed review no longer blocks the next ordinary message", async () => {
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

test("an identical prepared review submission can be claimed after restart", async () => {
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
  const prepared = await prepareConversationRun(input);

  try {
    assert.equal(
      (await runStore.latestRun(input.threadId))?.status,
      "dispatching",
    );
  } finally {
    prepared.releaseDispatch();
  }
});

test("competing dispatch claims retain the winner until its explicit release", async () => {
  const input = inputFor("dispatch-ownership");
  const { synchronizeConversation } = await import("./checkpoint-sync");

  await runStore.admitRun({
    threadId: input.threadId,
    runId: input.runId,
    messageId: input.messages[0]!.id,
    request: input,
    userMessage: input.messages[0]!,
    isResume: false,
  });
  const claims = await Promise.all([
    runStore.claimPreparedDispatch(input.runId),
    runStore.claimPreparedDispatch(input.runId),
  ]);

  try {
    assert.equal(claims.filter(Boolean).length, 1);
    assert.equal(runStore.hasRunDispatchOwner(input.runId), true);
    await synchronizeConversation(input.threadId);
    assert.equal(
      (await runStore.latestRun(input.threadId))?.status,
      "dispatching",
    );
    listedRuns = [
      {
        run_id: "upstream-run",
        config: { metadata: { agui_run_id: input.runId } },
      },
    ];
    await synchronizeConversation(input.threadId);
    assert.equal((await runStore.latestRun(input.threadId))?.status, "running");
    assert.equal(runStore.hasRunDispatchOwner(input.runId), true);
  } finally {
    listedRuns = [];

    for (const release of claims) {
      release?.();
      release?.();
    }
  }

  assert.equal(runStore.hasRunDispatchOwner(input.runId), false);
});

test("a persisted orphan dispatch remains recoverable as submission unknown after restart", async () => {
  const run = await admit("orphan-dispatch");
  const { synchronizeConversation } = await import("./checkpoint-sync");

  assert.equal(runStore.hasRunDispatchOwner(run.aguiRunId), false);
  await synchronizeConversation(run.threadId);

  assert.equal(
    (await runStore.latestRun(run.threadId))?.status,
    "submission_unknown",
  );
  assert.equal(await runStore.claimPreparedDispatch(run.aguiRunId), null);
  assert.equal(runStore.hasRunDispatchOwner(run.aguiRunId), false);
});

test("an unknown submission can recover its newest confirmed native mapping", async () => {
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
