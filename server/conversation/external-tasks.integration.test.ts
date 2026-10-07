import { afterAll, beforeAll, beforeEach, test, vi } from "vitest";
import assert from "node:assert/strict";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { InterruptSchema } from "@ag-ui/client";
import { eq, sql } from "drizzle-orm";
import {
  createIntegrationDatabase,
  type IntegrationDatabase,
} from "../tests/database";

let testDatabase: IntegrationDatabase;
let database: typeof import("../db/database");
let schema: typeof import("../db/schema");
let app: (typeof import("../app"))["app"];
const creations = new Map<string, number>();
const runs = new Map<string, object>();
const completed = new Set<string>();
const controls: { path: string; authorization: string; body: unknown }[] = [];
let controlStatus = 202;
const stalledResponses = new Map<string, ServerResponse>();
const creationModes = new Map<
  string,
  "lost-response" | "unconfirmed" | "stall" | "stall-read"
>();
const creationGates = new Map<
  string,
  {
    entered: () => void;
    release: Promise<void>;
    finish?: Promise<void>;
    finished?: () => void;
  }
>();

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
) {
  response.setHeader("Content-Type", "application/json");
  const pathname = new URL(request.url ?? "/", "http://fixture").pathname;
  const threadId = pathname.split("/")[2] ?? "";

  if (pathname === "/agent-info") {
    response.end(
      JSON.stringify({
        model: "test-model",
        defaultModelId: "deepseek",
        models: [
          {
            id: "deepseek",
            label: "DeepSeek",
            model: "test-model",
            available: true,
          },
          {
            id: "qwen",
            label: "Qwen",
            model: "qwen3.8-flash",
            available: true,
          },
        ],
      }),
    );

    return;
  }

  if (pathname === "/assistants/search") {
    response.end(
      JSON.stringify([
        { assistant_id: "agent", graph_id: "agent", config: {} },
      ]),
    );

    return;
  }

  if (pathname === "/assistants/agent/schemas") {
    response.end("{}");

    return;
  }

  if (pathname === "/assistants/agent/graph") {
    response.end(JSON.stringify({ nodes: [{ id: "agent" }], edges: [] }));

    return;
  }

  if (request.method === "GET" && pathname === `/threads/${threadId}`) {
    response.end(JSON.stringify({ thread_id: threadId, metadata: {} }));

    return;
  }

  if (request.method === "POST" && pathname.endsWith("/runs/stream")) {
    let body = "";

    for await (const chunk of request) {
      body += String(chunk);
    }

    const input = JSON.parse(body) as { config: { metadata: object } };
    const gate = creationGates.get(threadId);

    assert.ok(gate);
    creations.set(threadId, (creations.get(threadId) ?? 0) + 1);
    gate.entered();
    await gate.release;

    if (creationModes.get(threadId) === "unconfirmed") {
      response.destroy();
      gate.finished?.();

      return;
    }

    const run = {
      run_id: randomUUID(),
      thread_id: threadId,
      status: "pending",
      config: input.config,
    };

    runs.set(threadId, run);

    if (creationModes.get(threadId) === "lost-response") {
      run.status = "success";
      completed.add(threadId);
      response.destroy();
      gate.finished?.();

      return;
    }

    response.setHeader("Content-Type", "text/event-stream");
    response.setHeader(
      "Content-Location",
      `/threads/${threadId}/runs/${run.run_id}`,
    );
    response.write(
      `event: metadata\ndata: ${JSON.stringify({ run_id: run.run_id })}\n\n`,
    );
    await gate.finish;
    run.status = "success";
    completed.add(threadId);
    response.end(
      `event: values\ndata: ${JSON.stringify({ messages: [] })}\n\n`,
    );
    gate.finished?.();

    return;
  }

  if (request.method === "POST" && pathname.startsWith("/a2a-demo/jobs/")) {
    let body = "";

    for await (const chunk of request) {
      body += String(chunk);
    }

    controls.push({
      path: pathname,
      authorization: request.headers.authorization ?? "",
      body: body ? JSON.parse(body) : null,
    });
    response.statusCode = controlStatus;
    response.end(
      JSON.stringify(
        controlStatus === 202
          ? { accepted: true }
          : { error: "Already completed" },
      ),
    );

    return;
  }

  if (request.method === "POST" && pathname.endsWith("/runs")) {
    let body = "";

    for await (const chunk of request) {
      body += String(chunk);
    }

    const input = JSON.parse(body) as {
      command: {
        resume: Record<
          string,
          { taskId: string; status: string; kind: string }
        >;
      };
      config: { metadata: object; configurable?: { model_id?: string } };
    };
    const result = Object.values(input.command.resume)[0];

    assert.ok(
      result?.status === "succeeded" ||
        result?.status === "failed" ||
        result?.status === "cancelled",
    );
    assert.equal(result.kind, "external_task_result");
    creations.set(threadId, (creations.get(threadId) ?? 0) + 1);
    const run = {
      run_id: randomUUID(),
      thread_id: threadId,
      status: "success",
      config: input.config,
    };
    const gate = creationGates.get(threadId);

    if (gate) {
      gate.entered();
      await gate.release;
    }

    if (creationModes.get(threadId) === "unconfirmed") {
      response.destroy();

      return;
    }

    runs.set(threadId, run);
    completed.add(threadId);

    if (creationModes.get(threadId) === "stall") {
      stalledResponses.set(threadId, response);

      return;
    }

    if (creationModes.get(threadId) === "lost-response") {
      response.destroy();

      return;
    }

    response.end(JSON.stringify(run));
  } else if (creationModes.get(threadId) === "stall-read") {
    stalledResponses.set(threadId, response);
  } else if (pathname.endsWith("/state")) {
    response.end(
      JSON.stringify({
        values: {
          messages: [
            {
              id: `reply-${threadId}`,
              type: "ai",
              content: "The background task completed.",
            },
          ],
        },
        tasks: [],
        next: [],
      }),
    );
  } else if (pathname.endsWith("/runs")) {
    response.end(
      JSON.stringify(runs.has(threadId) ? [runs.get(threadId)] : []),
    );
  } else {
    response.end(JSON.stringify(runs.get(threadId)));
  }
}

const upstream = createServer((request, response) => {
  void handleRequest(request, response).catch((error: unknown) => {
    response.statusCode = 500;
    response.end(JSON.stringify({ error: String(error) }));
  });
});

beforeAll(async () => {
  await new Promise<void>((resolve) =>
    upstream.listen(0, "127.0.0.1", resolve),
  );
  const address = upstream.address();

  assert.ok(address && typeof address !== "string");
  process.env.WORKFLOW_API_TOKEN = "integration-workflow-token";
  process.env.AEGRA_URL = `http://127.0.0.1:${address.port}`;
  testDatabase = await createIntegrationDatabase();
  process.env.APP_DATABASE_URL = testDatabase.url;
  database = await import("../db/database");
  schema = await import("../db/schema");
  await database.migrateServer();
  await database.db.execute(sql`CREATE TABLE workflow_outputs (
    id text PRIMARY KEY, thread_id text NOT NULL, agui_run_id text NOT NULL,
    workflow_call_id text NOT NULL, step_id text NOT NULL, step_seq integer NOT NULL,
    output_seq bigint NOT NULL, kind text NOT NULL DEFAULT 'a2ui', version integer NOT NULL,
    payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
  )`);
  app = (await import("../app")).app;
});

beforeEach(async () => {
  for (const response of stalledResponses.values()) {
    response.destroy();
  }

  stalledResponses.clear();
  creationModes.clear();
  creationGates.clear();
  creations.clear();
  runs.clear();
  completed.clear();
  controls.length = 0;
  controlStatus = 202;
  await database.db.execute(sql`
    TRUNCATE external_task_events, external_tasks,
      conversation_messages, conversation_runs, conversations, workflow_outputs
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

async function register() {
  const threadId = randomUUID();
  const taskId = randomUUID();
  const runId = randomUUID();
  const callId = `call-${taskId}`;
  const interrupt = InterruptSchema.parse({
    id: `wait-${taskId}`,
    reason: "Waiting for external task",
    metadata: {
      langgraph: {
        raw: { kind: "workflow_external_wait", taskId, workflowCallId: callId },
      },
    },
  });

  await database.db.insert(schema.conversations).values({ threadId });
  await database.db.insert(schema.conversationRuns).values({
    aguiRunId: runId,
    threadId,
    messageId: randomUUID(),
    submitSeq: 1,
    status: "interrupted",
    checkpointSynced: true,
    interrupts: [interrupt],
    request: {
      runId,
      threadId,
      messages: [],
      tools: [],
      context: [],
      state: {},
    },
  });
  await database.db
    .update(schema.conversations)
    .set({ nextSubmitSeq: 2 })
    .where(eq(schema.conversations.threadId, threadId));
  const request = {
    taskId,
    threadId,
    workflowCallId: callId,
    runId,
    label: "Build artifact",
    stepId: "build",
  };
  const response = await app.request("/internal/external-tasks", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer integration-workflow-token",
    },
    body: JSON.stringify(request),
  });

  assert.equal(response.status, 200);
  const body = (await response.json()) as { callbackToken: string };

  assert.ok(body.callbackToken);

  return { threadId, taskId, request, token: body.callbackToken, interrupt };
}

async function update(
  taskId: string,
  token: string,
  revision: number,
  status = "running",
  message = "Building",
) {
  return app.request(`/external-tasks/${taskId}/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      revision,
      status,
      stage: "build",
      message,
      progress: status === "succeeded" ? 100 : 50,
      ...(status === "succeeded" ? { result: { artifact: "ready" } } : {}),
      ...(status === "failed" ? { error: "Artifact build failed" } : {}),
    }),
  });
}

test("task callbacks are authenticated, ordered and durable without exposing credentials", async () => {
  const task = await register();

  assert.equal((await update(task.taskId, "wrong", 1)).status, 401);
  assert.equal((await update(task.taskId, task.token, 2)).status, 200);
  assert.equal((await update(task.taskId, task.token, 2)).status, 200);
  assert.equal(
    (await update(task.taskId, task.token, 2, "running", "Conflict")).status,
    409,
  );
  assert.equal((await update(task.taskId, task.token, 1)).status, 200);
  assert.equal(
    (await update(task.taskId, task.token, 3, "succeeded")).status,
    200,
  );
  assert.equal((await update(task.taskId, task.token, 4)).status, 409);
  const { externalTaskSnapshots } = await import("./external-tasks");
  const snapshots = await externalTaskSnapshots(task.threadId);

  assert.equal(snapshots[0]?.revision, 3);
  assert.deepEqual(
    snapshots[0]?.history.map((event) => event.revision),
    [2, 3],
  );
  assert.equal(JSON.stringify(snapshots).includes(task.token), false);
});

test("A2A snapshots keep latest child text while durable history stays bounded", async () => {
  const task = await register();
  const outputs = [
    {
      agent: "Planner",
      step: "plan",
      taskId: "remote-1",
      contextId: "context-1",
      status: "input_required",
      text: "First second",
    },
  ];
  const payload = {
    revision: 1,
    kind: "a2a",
    status: "input_required",
    stage: "plan",
    message: "Audience?",
    outputs,
  };
  const callback = (body: object) =>
    app.request(`/external-tasks/${task.taskId}/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${task.token}`,
      },
      body: JSON.stringify(body),
    });

  assert.equal((await callback(payload)).status, 200);
  assert.equal((await callback(payload)).status, 200);
  const { externalTaskSnapshots } = await import("./external-tasks");
  const { externalTaskEvents, externalTasks } =
    await import("../db/external-task-schema");
  const [snapshot] = await externalTaskSnapshots(task.threadId);
  const [stored] = await database.db
    .select()
    .from(externalTasks)
    .where(eq(externalTasks.taskId, task.taskId));
  const events = await database.db
    .select()
    .from(externalTaskEvents)
    .where(eq(externalTaskEvents.taskId, task.taskId));

  assert.equal(snapshot?.kind, "a2a");
  assert.deepEqual(snapshot?.outputs, outputs);
  assert.deepEqual(stored?.update.outputs, outputs);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.update.outputs, undefined);
  assert.equal(JSON.stringify(snapshot).includes(task.token), false);
  assert.equal(
    (
      await callback({
        ...payload,
        revision: 2,
        status: "cancelled",
        message: "Cancelled",
      })
    ).status,
    200,
  );
  assert.equal(
    (await callback({ ...payload, revision: 3, status: "running" })).status,
    409,
  );
});

test("A2A controls validate ownership and status, use private credentials and await callbacks", async ({
  onTestFinished,
}) => {
  vi.stubEnv("A2A_DEMO_API_URL", " ");
  onTestFinished(() => {
    vi.unstubAllEnvs();
  });

  const task = await register();
  const control = (action: string, input?: string) =>
    app.request(`/external-tasks/${task.taskId}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      ...(input !== undefined ? { body: JSON.stringify({ input }) } : {}),
    });
  const callback = (revision: number, status: string) =>
    app.request(`/external-tasks/${task.taskId}/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${task.token}`,
      },
      body: JSON.stringify({
        revision,
        kind: "a2a",
        status,
        stage: "plan",
        message: "Planning",
      }),
    });

  assert.equal((await control("cancel")).status, 409);
  assert.equal((await control("input", " ")).status, 400);
  assert.equal((await control("input", "x".repeat(4001))).status, 400);
  assert.equal((await control("input", `x${" ".repeat(4000)}`)).status, 400);
  assert.equal((await callback(1, "queued")).status, 200);
  assert.equal((await control("input", "Engineering team")).status, 409);
  const cancelled = await control("cancel");

  assert.equal(cancelled.status, 202);
  assert.deepEqual(await cancelled.json(), { accepted: true });
  assert.deepEqual(controls[0], {
    path: `/a2a-demo/jobs/${task.taskId}/cancel`,
    authorization: `Bearer ${task.token}`,
    body: null,
  });
  const { externalTaskSnapshots } = await import("./external-tasks");

  assert.equal(
    (await externalTaskSnapshots(task.threadId))[0]?.status,
    "queued",
  );
  assert.equal((await callback(2, "input_required")).status, 200);
  assert.equal((await control("input", "Engineering team")).status, 202);
  assert.deepEqual(controls[1], {
    path: `/a2a-demo/jobs/${task.taskId}/input`,
    authorization: `Bearer ${task.token}`,
    body: { input: "Engineering team" },
  });
  controlStatus = 409;
  const completedRace = await control("cancel");

  assert.equal(completedRace.status, 409);
  assert.deepEqual(await completedRace.json(), { error: "Already completed" });
  await database.db
    .update(schema.conversations)
    .set({ deletedAt: new Date() })
    .where(eq(schema.conversations.threadId, task.threadId));
  assert.equal((await control("input", "Engineering team")).status, 404);
  assert.equal(controls.length, 3);
});

test("A2A callbacks accept six bounded international output snapshots", async () => {
  const task = await register();
  const response = await app.request(`/external-tasks/${task.taskId}/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${task.token}`,
    },
    body: JSON.stringify({
      revision: 1,
      kind: "a2a",
      status: "running",
      stage: "plan",
      message: "Planning",
      outputs: Array.from({ length: 6 }, (_, index) => ({
        agent: "Planner",
        step: `plan-${index}`,
        taskId: `remote-${index}`,
        contextId: "context-1",
        status: "running",
        text: "文".repeat(100000),
      })),
    }),
  });

  assert.equal(response.status, 200);
});

test.each(["succeeded", "cancelled"])(
  "A2A %s resumes with the external task result discriminator",
  async (status) => {
    const task = await register();
    const response = await app.request(
      `/external-tasks/${task.taskId}/events`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${task.token}`,
        },
        body: JSON.stringify({
          revision: 1,
          kind: "a2a",
          status,
          stage: "done",
          message: "Agents finished",
          ...(status === "succeeded" ? { result: { proposal: "Ready" } } : {}),
        }),
      },
    );

    assert.equal(response.status, 200);
    const { processExternalTasks } = await import("./external-task-worker");

    await processExternalTasks();
    await processExternalTasks();
    assert.equal(creations.get(task.threadId), 1);
    const { conversationSnapshot } = await import("./conversation-snapshot");
    const snapshot = await conversationSnapshot(task.threadId);

    assert.equal(snapshot?.runs.at(-1)?.status, "completed");
  },
);

test("a completed external task resumes and archives a workflow with no browser", async () => {
  const task = await register();

  assert.equal(
    (await update(task.taskId, task.token, 1, "succeeded")).status,
    200,
  );
  const { processExternalTasks } = await import("./external-task-worker");

  await processExternalTasks();
  await processExternalTasks();
  await processExternalTasks();
  assert.equal(creations.get(task.threadId), 1);
  assert.equal(completed.has(task.threadId), true);
  const { conversationSnapshot } = await import("./conversation-snapshot");
  const snapshot = await conversationSnapshot(task.threadId);

  assert.equal(snapshot?.runs.at(-1)?.status, "completed");
  assert.equal(
    snapshot?.messages.at(-1)?.content,
    "The background task completed.",
  );
  assert.equal(snapshot?.interrupts.length, 0);
});

test("background continuation inherits the paused run's pinned model after restart", async () => {
  const task = await register();

  await database.db
    .update(schema.conversationRuns)
    .set({ modelId: "qwen" })
    .where(eq(schema.conversationRuns.aguiRunId, task.request.runId));
  await database.db
    .update(schema.conversations)
    .set({ modelId: "deepseek" })
    .where(eq(schema.conversations.threadId, task.threadId));
  assert.equal(
    (await update(task.taskId, task.token, 1, "succeeded")).status,
    200,
  );
  const { processExternalTasks } = await import("./external-task-worker");

  await processExternalTasks();
  const { latestRun } = await import("./run-store");

  assert.equal((await latestRun(task.threadId))?.modelId, "qwen");
  const created = runs.get(task.threadId) as {
    config: { configurable: { model_id?: string } };
  };

  assert.equal(created.config.configurable.model_id, "qwen");
});

test("continuation scans exclude settled history but retain unsynchronized and pending tasks", async () => {
  const settled = await register();
  const pending = await register();
  const unsynchronized = await register();

  for (const task of [settled, unsynchronized]) {
    await database.db
      .update(schema.conversationRuns)
      .set({
        status: "completed",
        checkpointSynced: task === settled,
      })
      .where(eq(schema.conversationRuns.aguiRunId, task.request.runId));
    const { externalTasks } = await import("../db/external-task-schema");

    await database.db
      .update(externalTasks)
      .set({ continuationRunId: task.request.runId })
      .where(eq(externalTasks.taskId, task.taskId));
  }

  const { scanExternalTasks } = await import("./external-task-scan");
  const found: string[] = [];

  for await (const { task } of scanExternalTasks()) {
    found.push(task.taskId);
  }

  assert.deepEqual(
    found.sort(),
    [pending.taskId, unsynchronized.taskId].sort(),
  );
});

test("continuation scans visit every active page without starving later tasks", async () => {
  const registered = await register();
  const { externalTasks } = await import("../db/external-task-schema");
  const [original] = await database.db
    .select()
    .from(externalTasks)
    .where(eq(externalTasks.taskId, registered.taskId));

  assert.ok(original);
  const additional = Array.from({ length: 101 }, (_, index) => ({
    ...original,
    taskId: randomUUID(),
    stepId: `step-${index}`,
  }));

  await database.db.insert(externalTasks).values(additional);
  const { scanExternalTasks } = await import("./external-task-scan");
  const found: string[] = [];

  for await (const { task } of scanExternalTasks()) {
    found.push(task.taskId);
  }

  assert.equal(found.length, 102);
  assert.equal(new Set(found).size, 102);
  assert.ok(found.includes(registered.taskId));
});

test("users cannot submit an external task result through the review endpoint", async () => {
  const task = await register();
  const response = await app.request("/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      threadId: task.threadId,
      runId: randomUUID(),
      messages: [],
      tools: [],
      context: [],
      state: {},
      resume: [
        {
          interruptId: task.interrupt.id,
          status: "resolved",
          payload: { taskId: task.taskId, status: "succeeded", result: {} },
        },
      ],
    }),
  });

  assert.equal(response.status, 409);
});

test("an early terminal callback waits for its durable interrupt", async () => {
  const task = await register();

  await database.db
    .update(schema.conversationRuns)
    .set({ status: "prepared", interrupts: [] })
    .where(eq(schema.conversationRuns.aguiRunId, task.request.runId));
  await update(task.taskId, task.token, 1, "succeeded");
  const { processExternalTasks } = await import("./external-task-worker");

  await processExternalTasks();
  assert.equal(creations.has(task.threadId), false);
  await database.db
    .update(schema.conversationRuns)
    .set({ status: "interrupted", interrupts: [task.interrupt] })
    .where(eq(schema.conversationRuns.aguiRunId, task.request.runId));
  await Promise.all([processExternalTasks(), processExternalTasks()]);
  await processExternalTasks();
  assert.equal(creations.get(task.threadId), 1);
});

test("an accepted continuation with a lost response is recovered without a second submission", async () => {
  const task = await register();

  creationModes.set(task.threadId, "lost-response");
  await update(task.taskId, task.token, 1, "succeeded");
  const { processExternalTasks } = await import("./external-task-worker");

  await processExternalTasks();
  await processExternalTasks();
  await processExternalTasks();
  const { conversationSnapshot } = await import("./conversation-snapshot");
  const snapshot = await conversationSnapshot(task.threadId);

  assert.equal(creations.get(task.threadId), 1);
  assert.equal(snapshot?.runs.at(-1)?.status, "completed");
});

test.each(["accepted", "unconfirmed"] as const)(
  "an in-flight %s continuation stays dispatching during concurrent snapshot recovery",
  async (outcome) => {
    const task = await register();
    let signalEntered!: () => void;
    let releaseCreation!: () => void;
    const entered = new Promise<void>((resolve) => {
      signalEntered = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseCreation = resolve;
    });

    creationGates.set(task.threadId, { entered: signalEntered, release });

    if (outcome === "unconfirmed") {
      creationModes.set(task.threadId, "unconfirmed");
    }

    await update(task.taskId, task.token, 1, "succeeded");
    const { processExternalTasks } = await import("./external-task-worker");
    const { synchronizeConversation } = await import("./checkpoint-sync");
    const { conversationSnapshot } = await import("./conversation-snapshot");
    const worker = processExternalTasks();

    try {
      await entered;
      assert.equal(runs.has(task.threadId), false);
      await synchronizeConversation(task.threadId);
      const response = await app.request(`/conversations/${task.threadId}`);
      const snapshot = (await response.json()) as Awaited<
        ReturnType<typeof conversationSnapshot>
      >;

      assert.equal(response.status, 200);
      assert.equal(snapshot?.runs.at(-1)?.aegraRunId, null);
      assert.equal(snapshot?.runs.at(-1)?.status, "dispatching");
      assert.equal(
        snapshot?.externalTasks[0]?.continuationStatus,
        "dispatching",
      );
      await processExternalTasks();
      assert.equal(creations.get(task.threadId), 1);
    } finally {
      releaseCreation();
      await worker;
      creationGates.delete(task.threadId);
    }

    await synchronizeConversation(task.threadId);
    await processExternalTasks();
    const settled = await conversationSnapshot(task.threadId);

    assert.equal(creations.get(task.threadId), 1);
    assert.equal(
      settled?.runs.at(-1)?.status,
      outcome === "accepted" ? "completed" : "submission_unknown",
    );
  },
);

test.each(["accepted", "lost-response", "unconfirmed"] as const)(
  "a disconnected HTTP consumer preserves its %s producer dispatch until creation settles",
  async (outcome) => {
    const threadId = randomUUID();
    const runId = randomUUID();
    let signalEntered!: () => void;
    let releaseCreation!: () => void;
    let finishStream!: () => void;
    let signalFinished!: () => void;
    const entered = new Promise<void>((resolve) => {
      signalEntered = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseCreation = resolve;
    });
    const finish = new Promise<void>((resolve) => {
      finishStream = resolve;
    });
    const finished = new Promise<void>((resolve) => {
      signalFinished = resolve;
    });

    creationGates.set(threadId, {
      entered: signalEntered,
      release,
      finish,
      finished: signalFinished,
    });

    if (outcome !== "accepted") {
      creationModes.set(threadId, outcome);
    }

    const { synchronizeConversation } = await import("./checkpoint-sync");
    const { conversationSnapshot } = await import("./conversation-snapshot");
    const { hasRunDispatchOwner, latestRun } = await import("./run-store");
    const response = await app.request("/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        threadId,
        runId,
        messages: [{ id: randomUUID(), role: "user", content: "Hello" }],
        tools: [],
        context: [],
        state: {},
      }),
    });
    const reader = response.body?.getReader();

    try {
      assert.equal(response.status, 200);
      assert.ok(reader);
      await entered;
      await reader.read();
      await reader.cancel();
      assert.equal(hasRunDispatchOwner(runId), true);
      await synchronizeConversation(threadId);
      const pending = await conversationSnapshot(threadId);

      assert.equal(pending?.runs.at(-1)?.status, "dispatching");
      assert.equal(pending?.runs.at(-1)?.aegraRunId, null);
      releaseCreation();
      await vi.waitUntil(() => !hasRunDispatchOwner(runId));

      if (outcome === "accepted") {
        assert.ok((await latestRun(threadId))?.aegraRunId);
        assert.equal(completed.has(threadId), false);
      }
    } finally {
      releaseCreation();
      finishStream();
      await finished;
      await vi.waitUntil(() => !hasRunDispatchOwner(runId));
      reader?.releaseLock();
      creationGates.delete(threadId);
    }

    await synchronizeConversation(threadId);
    const settled = await conversationSnapshot(threadId);

    assert.equal(creations.get(threadId), 1);
    assert.equal(
      settled?.runs.at(-1)?.status,
      outcome === "unconfirmed" ? "submission_unknown" : "completed",
    );
  },
);

test("an unconfirmed continuation stays unknown and is never blindly re-created", async () => {
  const task = await register();

  creationModes.set(task.threadId, "unconfirmed");
  await update(task.taskId, task.token, 1, "succeeded");
  const { processExternalTasks } = await import("./external-task-worker");

  await processExternalTasks();
  await processExternalTasks();
  await processExternalTasks();
  const { conversationSnapshot } = await import("./conversation-snapshot");
  const snapshot = await conversationSnapshot(task.threadId);

  assert.equal(creations.get(task.threadId), 1);
  assert.equal(snapshot?.runs.at(-1)?.status, "submission_unknown");
});

test("deleted conversations reject callbacks and do not create continuations", async () => {
  const task = await register();

  await update(task.taskId, task.token, 1, "succeeded");
  await database.db
    .update(schema.conversations)
    .set({ deletedAt: new Date() })
    .where(eq(schema.conversations.threadId, task.threadId));
  assert.equal(
    (await update(task.taskId, task.token, 1, "succeeded")).status,
    404,
  );
  const { processExternalTasks } = await import("./external-task-worker");

  await processExternalTasks();
  assert.equal(creations.has(task.threadId), false);
});

test("registration is authenticated and replay keeps the callback identity", async () => {
  const task = await register();
  const options = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(task.request),
  };

  assert.equal(
    (await app.request("/internal/external-tasks", options)).status,
    401,
  );
  const response = await app.request("/internal/external-tasks", {
    ...options,
    headers: {
      ...options.headers,
      Authorization: "Bearer integration-workflow-token",
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    taskId: task.taskId,
    callbackToken: task.token,
  });
});

test("external failures also resume the workflow with a terminal result", async () => {
  const task = await register();

  await update(task.taskId, task.token, 1, "failed");
  const { processExternalTasks } = await import("./external-task-worker");

  await processExternalTasks();
  await processExternalTasks();
  assert.equal(creations.get(task.threadId), 1);
});

test("telemetry-enabled server shutdown releases its subscription and exports work before exit", async () => {
  const task = await register();
  const probe = createServer();
  const exports: string[] = [];
  const collector = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      exports.push(request.url ?? "");
      response.writeHead(200);
      response.end("{}");
    });
  });

  await new Promise<void>((resolve) =>
    collector.listen(0, "127.0.0.1", resolve),
  );
  const collectorAddress = collector.address();

  assert.ok(collectorAddress && typeof collectorAddress !== "string");

  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const address = probe.address();

  assert.ok(address && typeof address !== "string");
  const port = address.port;

  await new Promise<void>((resolve) => probe.close(() => resolve()));
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "--import",
      "./tests/signal-control.ts",
      "--import",
      "./observability/bootstrap.ts",
      "server.ts",
    ],
    {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      env: {
        ...process.env,
        SERVER_PORT: String(port),
        OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${collectorAddress.port}`,
      },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    },
  );
  const exited = new Promise<number | null>((resolve) =>
    child.once("exit", resolve),
  );
  let processError: Error | undefined;
  let output = "";

  child.on("error", (error) => {
    processError = error;
  });
  child.stdout!.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr!.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  const delay = (milliseconds: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

  try {
    await vi.waitUntil(
      () => {
        if (processError) {
          throw processError;
        }

        const terminated = child.exitCode !== null || child.signalCode !== null;

        assert.equal(terminated, false, output);

        return output.includes("AG-UI server listening");
      },
      { timeout: 15_000, interval: 20 },
    );

    const stream = await fetch(
      `http://127.0.0.1:${port}/conversations/${task.threadId}/events`,
    );
    const reader = stream.body!.getReader();
    const first = await reader.read();

    assert.match(new TextDecoder().decode(first.value), /event: ready/);
    const observed = await fetch(`http://127.0.0.1:${port}/agent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    assert.equal(observed.status, 400);
    child.send("shutdown-test");
    const outcome = await Promise.race([
      exited,
      delay(2000).then(() => "timeout"),
    ]);

    assert.equal(outcome, 0, output);
    assert.ok(exports.includes("/v1/traces"), output);
    assert.ok(exports.includes("/v1/metrics"), output);
    // Shutdown already closed the live transport, so cancellation may reject.
    await reader.cancel().catch(() => undefined);
  } finally {
    if (
      child.pid !== undefined &&
      child.exitCode === null &&
      child.signalCode === null
    ) {
      child.kill("SIGKILL");
      await exited;
    }

    await new Promise<void>((resolve) => collector.close(() => resolve()));
  }
});

test("unchanged run observations do not trigger another snapshot invalidation", async () => {
  const task = await register();
  const pg = await import("pg");
  const subscriber = new pg.default.Client({
    connectionString: process.env.APP_DATABASE_URL,
  });
  const notifications: string[] = [];

  subscriber.on("notification", (notification) => {
    notifications.push(notification.payload ?? "");
  });
  await subscriber.connect();

  try {
    await subscriber.query("LISTEN conversation_changed");
    await database.db
      .update(schema.conversationRuns)
      .set({ status: "interrupted" })
      .where(eq(schema.conversationRuns.aguiRunId, task.request.runId));
    await subscriber.query("SELECT 1");
    assert.deepEqual(notifications, []);
    await database.db
      .update(schema.conversationRuns)
      .set({ status: "failed" })
      .where(eq(schema.conversationRuns.aguiRunId, task.request.runId));
    await subscriber.query("SELECT 1");
    assert.deepEqual(notifications, [task.threadId]);
  } finally {
    await subscriber.end();
  }
});

test.each(["stall", "stall-read"] as const)(
  "worker shutdown aborts an in-flight %s request",
  async (mode) => {
    const task = await register();

    creationModes.set(task.threadId, mode);
    await update(task.taskId, task.token, 1, "succeeded");
    const { startExternalTaskWorker } = await import("./external-task-worker");
    const stop = startExternalTaskWorker();
    let stopped: Promise<void> | undefined;
    const delay = (milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

    try {
      for (
        let attempt = 0;
        attempt < 100 && !stalledResponses.has(task.threadId);
        attempt += 1
      ) {
        await delay(20);
      }

      assert.ok(stalledResponses.has(task.threadId));
      stopped = stop();
      const result = await Promise.race([
        stopped.then(() => "stopped"),
        delay(2000).then(() => "timeout"),
      ]);

      assert.equal(result, "stopped");
      assert.equal(creations.get(task.threadId), 1);
    } finally {
      creationModes.delete(task.threadId);
      stalledResponses
        .get(task.threadId)
        ?.end(JSON.stringify(runs.get(task.threadId)));
      await (stopped ?? stop());
    }
  },
);

test("a bounded stalled creation does not block another completed external task", async () => {
  const stalled = await register();
  const other = await register();

  creationModes.set(stalled.threadId, "stall");
  await update(stalled.taskId, stalled.token, 1, "succeeded");
  await update(other.taskId, other.token, 1, "succeeded");
  const { Client } = await import("@langchain/langgraph-sdk");
  const client = new Client({
    apiUrl: process.env.AEGRA_URL!,
    timeoutMs: 50,
    callerOptions: { maxRetries: 0 },
  });
  const { processExternalTasks } = await import("./external-task-worker");
  const processing = processExternalTasks(client);
  const delay = (milliseconds: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

  try {
    const result = await Promise.race([
      processing.then(() => "completed"),
      delay(500).then(() => "timeout"),
    ]);

    assert.equal(result, "completed");
    assert.equal(creations.get(other.threadId), 1);
    assert.equal(creations.get(stalled.threadId), 1);
  } finally {
    creationModes.delete(stalled.threadId);
    stalledResponses
      .get(stalled.threadId)
      ?.end(JSON.stringify(runs.get(stalled.threadId)));
    await processing;
  }
});
