import { afterAll, beforeAll, test } from "vitest";
import assert from "node:assert/strict";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { InterruptSchema } from "@ag-ui/client";
import { eq, sql } from "drizzle-orm";

let postgres: StartedPostgreSqlContainer;
let database: typeof import("../db/database");
let schema: typeof import("../db/schema");
let app: (typeof import("../app"))["app"];
const creations = new Map<string, number>();
const runs = new Map<string, object>();
const completed = new Set<string>();
const stalledResponses = new Map<string, ServerResponse>();
const creationModes = new Map<
  string,
  "lost-response" | "unconfirmed" | "stall" | "stall-read"
>();

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
) {
  response.setHeader("Content-Type", "application/json");
  const pathname = new URL(request.url ?? "/", "http://fixture").pathname;
  const threadId = pathname.split("/")[2] ?? "";

  if (request.method === "POST" && pathname.endsWith("/runs")) {
    let body = "";

    for await (const chunk of request) {
      body += String(chunk);
    }

    const input = JSON.parse(body) as {
      command: { resume: Record<string, { taskId: string; status: string }> };
      config: { metadata: object };
    };
    const result = Object.values(input.command.resume)[0];

    assert.ok(result?.status === "succeeded" || result?.status === "failed");
    creations.set(threadId, (creations.get(threadId) ?? 0) + 1);
    const run = {
      run_id: randomUUID(),
      thread_id: threadId,
      status: "success",
      config: input.config,
    };

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
  postgres = await new PostgreSqlContainer("postgres:18-alpine").start();
  process.env.APP_DATABASE_URL = postgres.getConnectionUri();
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

afterAll(async () => {
  upstream.closeAllConnections();
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
  await database?.db.$client.end();
  await postgres?.stop();
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

test("server shutdown releases an open notification subscription and its worker resources", async () => {
  const task = await register();
  const probe = createServer();

  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const address = probe.address();

  assert.ok(address && typeof address !== "string");
  const port = address.port;

  await new Promise<void>((resolve) => probe.close(() => resolve()));
  const child = spawn(process.execPath, ["--import", "tsx", "server.ts"], {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    env: { ...process.env, SERVER_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = new Promise<number | null>((resolve) =>
    child.once("exit", resolve),
  );
  let output = "";

  child.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  const delay = (milliseconds: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

  try {
    for (
      let attempt = 0;
      attempt < 100 && !output.includes("AG-UI server listening");
      attempt += 1
    ) {
      await delay(20);
    }

    assert.match(output, /AG-UI server listening/);
    const stream = await fetch(
      `http://127.0.0.1:${port}/conversations/${task.threadId}/events`,
    );
    const reader = stream.body!.getReader();
    const first = await reader.read();

    assert.match(new TextDecoder().decode(first.value), /event: ready/);
    child.kill("SIGTERM");
    const outcome = await Promise.race([
      exited,
      delay(2000).then(() => "timeout"),
    ]);

    assert.equal(outcome, 0, output);
    // Shutdown already closed the live transport, so cancellation may reject.
    await reader.cancel().catch(() => undefined);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await exited;
    }
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
