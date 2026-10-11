import assert from "node:assert/strict";
import { afterAll, beforeAll, beforeEach, test, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { RunAgentInput } from "@ag-ui/client";
import type { AgentInfo } from "../../../../shared/agent-info.js";
import pg from "pg";
import { once } from "node:events";
import {
  createIntegrationDatabase,
  type IntegrationDatabase,
} from "../../../tests/database.js";

let testDatabase: IntegrationDatabase;
let database: typeof import("../../db/database.js");
let schema: typeof import("../../db/conversation-schema.js");
let admission: typeof import("./run-admission.js");
let store: typeof import("./run-store.js");
let app: (typeof import("../../app.js"))["app"];
const catalog = {
  model: "deepseek-flash",
  defaultModelId: "deepseek",
  models: [
    {
      id: "deepseek",
      label: "DeepSeek",
      model: "deepseek-flash",
      available: true,
    },
    { id: "qwen", label: "Qwen", model: "qwen3.8-flash", available: true },
  ],
} satisfies AgentInfo;

beforeAll(async () => {
  testDatabase = await createIntegrationDatabase();
  process.env.APP_DATABASE_URL = testDatabase.url;
  database = await import("../../db/database.js");
  schema = await import("../../db/conversation-schema.js");
  store = await import("./run-store.js");
  admission = await import("./run-admission.js");
  ({ app } = await import("../../app.js"));
  await database.migrateServer();
  await database.db.execute(sql`
    CREATE TABLE workflow_outputs (
      id text PRIMARY KEY, thread_id text NOT NULL, agui_run_id text,
      workflow_call_id text NOT NULL, step_id text NOT NULL, step_seq integer,
      output_seq bigint, kind text, version integer, payload jsonb,
      created_at timestamptz DEFAULT now()
    )
  `);
});

beforeEach(() => {
  vi.stubGlobal("fetch", () => Promise.resolve(Response.json(catalog)));
});

afterAll(async () => {
  await database?.db.$client.end();
  await testDatabase?.dispose();
});

function inputFor(threadId: string, modelId?: string): RunAgentInput {
  return {
    threadId,
    runId: `${threadId}-run`,
    messages: [{ id: `${threadId}-message`, role: "user", content: "Hello" }],
    state: {},
    tools: [],
    context: [],
    ...(modelId ? { forwardedProps: { modelId } } : {}),
  };
}

function admit(input: RunAgentInput, agentInfo: AgentInfo = catalog) {
  return admission.admitRun({
    threadId: input.threadId,
    runId: input.runId,
    messageId: input.messages[0]!.id,
    request: input,
    userMessage: input.messages[0]!,
    isResume: false,
    agentInfo,
  });
}

function select(threadId: string, modelId: unknown) {
  return app.request(`/conversations/${threadId}/model`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ modelId }),
  });
}

test("admission pins the selected model and exact retries keep it after the default changes", async () => {
  const input = inputFor("selected", "qwen");
  const first = await admit(input);

  assert.equal(first.row.modelId, "qwen");
  const duplicate = await admit(input, { ...catalog, defaultModelId: "qwen" });

  assert.equal(duplicate.row.modelId, "qwen");
  await assert.rejects(
    admit({ ...input, forwardedProps: { modelId: "deepseek" } }),
    /Conflicting/,
  );
  const { conversationSnapshot } = await import("../history/snapshot.js");
  const snapshot = await conversationSnapshot(input.threadId);

  assert.equal(snapshot?.modelId, "qwen");
  assert.equal(snapshot?.runs[0]?.modelId, "qwen");
});

test("an exact prepared retry retains its original model when the new default is unavailable", async () => {
  const input = inputFor("default-retry");
  const original = await admit(input);
  const changed = {
    ...catalog,
    defaultModelId: "qwen" as const,
    models: catalog.models.map((model) => ({ ...model, available: false })),
  };
  const duplicate = await admit(input, changed);

  assert.equal(original.row.modelId, "deepseek");
  assert.equal(duplicate.row.modelId, "deepseek");
});

test("new admissions reject unknown and unavailable models without saving a run", async () => {
  const unavailable = {
    ...catalog,
    models: catalog.models.map((model) => ({
      ...model,
      available: model.id !== "qwen",
    })),
  };

  await assert.rejects(
    admit(inputFor("unknown-model", "unknown")),
    /Unknown conversation model/,
  );
  await assert.rejects(
    admit(inputFor("unavailable-model", "qwen"), unavailable),
    /model is unavailable/,
  );
  assert.equal(await store.latestRun("unknown-model"), null);
  assert.equal(await store.latestRun("unavailable-model"), null);
});

test("legacy direct admissions remain readable with nullable model selections", async () => {
  const input = inputFor("legacy-model");
  const legacy = await admission.admitRun({
    threadId: input.threadId,
    runId: input.runId,
    messageId: input.messages[0]!.id,
    request: input,
    userMessage: input.messages[0]!,
    isResume: false,
  });
  const { conversationSnapshot } = await import("../history/snapshot.js");
  const snapshot = await conversationSnapshot(input.threadId);

  assert.equal(legacy.row.modelId, null);
  assert.equal(snapshot?.modelId, null);
  assert.equal(snapshot?.runs[0]?.modelId, null);
});

test("a review resumes with its paused run model after selection and default drift", async () => {
  const input = inputFor("resume", "qwen");

  await admit(input);
  await database.db
    .update(schema.conversationRuns)
    .set({
      status: "interrupted",
      interrupts: [
        {
          id: "review",
          reason: "Review",
          metadata: { langgraph: { raw: { workflowCallId: "call" } } },
        },
      ],
    })
    .where(eq(schema.conversationRuns.aguiRunId, input.runId));
  await database.db.execute(
    sql`INSERT INTO workflow_outputs (id, thread_id, workflow_call_id, step_id) VALUES ('review-output', 'resume', 'call', 'review')`,
  );
  await database.db
    .update(schema.conversations)
    .set({ modelId: "deepseek" })
    .where(eq(schema.conversations.threadId, input.threadId));
  const request: RunAgentInput = {
    ...input,
    runId: "resume-review-run",
    messages: [],
    forwardedProps: { modelId: "qwen" },
    resume: [{ interruptId: "review", status: "resolved", payload: {} }],
  };
  const resumed = await admission.admitRun({
    threadId: input.threadId,
    runId: request.runId,
    messageId: request.runId,
    request,
    userMessage: null,
    isResume: true,
    agentInfo: catalog,
  });

  assert.equal(resumed.row.modelId, "qwen");
  assert.equal((await store.latestRun(input.threadId))?.modelId, "qwen");
});

test("a review rejects a client model that differs from the paused run", async () => {
  const input = inputFor("resume-conflict", "qwen");

  await admit(input);
  await database.db
    .update(schema.conversationRuns)
    .set({
      status: "interrupted",
      interrupts: [
        {
          id: "review",
          reason: "Review",
          metadata: {
            langgraph: { raw: { workflowCallId: "conflicting-call" } },
          },
        },
      ],
    })
    .where(eq(schema.conversationRuns.aguiRunId, input.runId));
  await database.db.execute(
    sql`INSERT INTO workflow_outputs (id, thread_id, workflow_call_id, step_id) VALUES ('conflicting-output', 'resume-conflict', 'conflicting-call', 'review')`,
  );
  const request: RunAgentInput = {
    ...input,
    runId: "conflicting-review-run",
    messages: [],
    forwardedProps: { modelId: "deepseek" },
    resume: [{ interruptId: "review", status: "resolved", payload: {} }],
  };

  await assert.rejects(
    admission.admitRun({
      threadId: input.threadId,
      runId: request.runId,
      messageId: request.runId,
      request,
      userMessage: null,
      isResume: true,
      agentInfo: catalog,
    }),
    /paused run model/,
  );
});

test("unsettled external work blocks switching even when the last run is completed", async () => {
  const input = inputFor("external-work");

  await admit(input);
  await database.db
    .update(schema.conversationRuns)
    .set({ status: "completed" })
    .where(eq(schema.conversationRuns.aguiRunId, input.runId));
  const { externalTasks } = await import("../../db/external-task-schema.js");

  await database.db.insert(externalTasks).values({
    taskId: "pending-task",
    threadId: input.threadId,
    workflowCallId: "external-call",
    stepId: "wait",
    label: "Background work",
    callbackToken: "token",
    status: "running",
    update: {
      revision: 1,
      status: "running",
      stage: "work",
      message: "Working",
    },
  });
  assert.equal((await select(input.threadId, "qwen")).status, 409);
});

test("an idle conversation selection governs later admissions and rejects unavailable options", async () => {
  const input = inputFor("idle");

  await admit(input);
  await database.db
    .update(schema.conversationRuns)
    .set({ status: "completed" })
    .where(eq(schema.conversationRuns.aguiRunId, input.runId));

  assert.equal((await select(input.threadId, "qwen")).status, 200);
  const next = {
    ...inputFor(input.threadId),
    runId: "next",
    messages: [{ id: "next-message", role: "user" as const, content: "Next" }],
  };

  assert.equal((await admit(next)).row.modelId, "qwen");
  assert.equal((await select("missing", "qwen")).status, 404);
  vi.stubGlobal("fetch", () =>
    Promise.resolve(
      Response.json({
        ...catalog,
        models: catalog.models.map((model) => ({
          ...model,
          available: model.id !== "qwen",
        })),
      }),
    ),
  );
  assert.equal((await select(input.threadId, "qwen")).status, 400);
  assert.equal((await select(input.threadId, "unknown")).status, 400);
});

test.each([
  "prepared",
  "dispatching",
  "running",
  "submission_unknown",
  "interrupted",
] as const)("%s conversations reject model switching", async (status) => {
  const input = inputFor(`blocked-${status}`);

  await admit(input);
  await database.db
    .update(schema.conversationRuns)
    .set({ status })
    .where(eq(schema.conversationRuns.aguiRunId, input.runId));

  assert.equal((await select(input.threadId, "qwen")).status, 409);
});

test("model switching serializes with admission", async () => {
  const input = inputFor("concurrent");

  await database.db
    .insert(schema.conversations)
    .values({ threadId: input.threadId });
  const [admitted, selected] = await Promise.all([
    admit(input),
    select(input.threadId, "qwen"),
  ]);

  if (selected.status === 200) {
    assert.equal(admitted.row.modelId, "qwen");
  } else {
    assert.equal(selected.status, 409);
    assert.equal(admitted.row.modelId, "deepseek");
  }
});

test("a committed model selection notifies snapshot subscribers", async () => {
  const threadId = "selection-notification";
  const listener = new pg.Client({ connectionString: testDatabase.url });

  await database.db.insert(schema.conversations).values({ threadId });
  await listener.connect();

  try {
    await listener.query("LISTEN conversation_changed");
    const notified = once(listener, "notification", {
      signal: AbortSignal.timeout(2000),
    });

    void notified.catch(() => undefined);
    const response = await select(threadId, "qwen");

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { threadId, modelId: "qwen" });
    const [notification] = (await notified) as [pg.Notification];

    assert.equal(notification.payload, threadId);
    const { conversationSnapshot } = await import("../history/snapshot.js");

    assert.equal((await conversationSnapshot(threadId))?.modelId, "qwen");
  } finally {
    await listener.end();
  }
});
