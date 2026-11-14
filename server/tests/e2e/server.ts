import { z } from "zod";
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  knowledgeCitationUrl,
  knowledgeSearchSchema,
} from "../../../shared/knowledge.js";
import { createSkillTestStorage } from "../skill-storage.js";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { skillFileSchema } from "../../../shared/skill-files.js";
import type { LangGraphPlatformMessage } from "@ag-ui/langgraph";
import { serve } from "@hono/node-server";
import type { Server } from "node:http";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import type { Message } from "@ag-ui/client";
import { completedMessages } from "../../src/agent/checkpoint-messages.js";
import { controlledAegra } from "./aegra.js";
import { randomUUID } from "node:crypto";
import {
  conversations,
  conversationMessages,
} from "../../src/db/conversation-schema.js";
import { scrollHistory } from "./scroll-history.js";

const KNOWLEDGE_SHUTDOWN_TIMEOUT_MS = 5_000;
const KNOWLEDGE_STARTUP_ATTEMPTS = 100;
const KNOWLEDGE_STARTUP_INTERVAL_MS = 100;
const KNOWLEDGE_SEARCH_TIMEOUT_MS = 10_000;
const REDIS_PORT = 6379;
const SHUTDOWN_SIGNALS = ["SIGTERM", "SIGINT"] as const;
// prettier-ignore
const KNOWLEDGE_WORKER_STDIO = [
  "ignore",
  "ignore",
  "inherit",
] as const;

let knowledgeProcess: ChildProcess | undefined;
let configurationDirectory: string | undefined;
let stopKnowledgeCleanup: (() => Promise<void>) | undefined;
let storage: StartedTestContainer | undefined;
let redis: StartedTestContainer | undefined;
let postgres: StartedPostgreSqlContainer | undefined;
let database: typeof import("../../src/db/database.js") | undefined;
let upstream: Server | undefined;
let backend: Server | undefined;
let agent: ReturnType<typeof controlledAegra> | undefined;
let stopping: Promise<void> | undefined;
let stopWorker: (() => Promise<void>) | undefined;

async function closeServer(server: Server | undefined) {
  if (!server?.listening) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
    // Stop accepting requests before forcing active connections to close.
    server.closeAllConnections();
  });
}

async function stopKnowledgeProcess() {
  const worker = knowledgeProcess;

  if (!worker?.pid || worker.exitCode !== null || worker.signalCode !== null) {
    return;
  }

  // Register before sending the signal so a fast exit cannot bypass the wait.
  const exited = new Promise<void>((resolve) => {
    worker.once("exit", () => resolve());
  });
  const timeout = setTimeout(
    () => worker.kill("SIGKILL"),
    KNOWLEDGE_SHUTDOWN_TIMEOUT_MS,
  );

  try {
    worker.kill("SIGTERM");
    await exited;
  } finally {
    clearTimeout(timeout);
  }
}

async function closeChangeSubscriptions() {
  const { closeConversationChanges } =
    await import("../../src/conversation/events/subscription.js");

  await closeConversationChanges();
}

async function closeStorageClient() {
  const { closeObjectStore } =
    await import("../../src/storage/object-store.js");

  closeObjectStore();
}

async function removeTestConfiguration() {
  if (configurationDirectory) {
    await rm(configurationDirectory, {
      recursive: true,
      force: true,
    });
  }
}

async function releaseResources() {
  // Release blocked streams and stop their producers before closing HTTP and
  // the shared clients. Containers and test configuration outlive their consumers.
  const steps = [
    () => agent?.releaseAll(),
    stopKnowledgeProcess,
    () => stopWorker?.(),
    () => stopKnowledgeCleanup?.(),
    () => closeServer(backend),
    () => closeServer(upstream),
    closeChangeSubscriptions,
    () => database?.db.$client.end(),
    () => postgres?.stop(),
    closeStorageClient,
    () => storage?.stop(),
    () => redis?.stop(),
    removeTestConfiguration,
  ];

  const failures: unknown[] = [];

  for (const release of steps) {
    try {
      await release();
    } catch (error) {
      failures.push(error);
    }
  }

  if (failures.length > 0) {
    throw new AggregateError(failures, "Unable to release all E2E resources");
  }
}

function stop() {
  stopping ??= releaseResources().catch(reportFailure);

  return stopping;
}

async function start() {
  storage = await createSkillTestStorage();
  redis = await new GenericContainer("redis:8-alpine")
    .withExposedPorts(REDIS_PORT)
    .start();
  postgres = await new PostgreSqlContainer(
    "pgvector/pgvector:0.8.7-pg18",
  ).start();

  process.env.APP_DATABASE_URL = postgres.getConnectionUri();
  const databaseModule = await import("../../src/db/database.js");

  database = databaseModule;
  await databaseModule.migrateServer();

  // Python owns this table. Match its read contract in the isolated test DB.
  await databaseModule.db.execute(sql`
    CREATE TABLE workflow_outputs (
      id text PRIMARY KEY,
      thread_id text NOT NULL,
      agui_run_id text NOT NULL,
      workflow_call_id text NOT NULL,
      step_id text NOT NULL,
      step_seq integer NOT NULL,
      output_seq bigint NOT NULL,
      kind text NOT NULL DEFAULT 'a2ui',
      version integer NOT NULL DEFAULT 1,
      payload jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (thread_id, workflow_call_id, step_id, version),
      UNIQUE (thread_id, output_seq)
    )
  `);

  const aegraFixture = controlledAegra(databaseModule.db);

  agent = aegraFixture;

  // Management uses the real Python routes and LangGraph PostgreSQL Store.
  aegraFixture.api.all("/memory/*", async (context) => {
    const url = new URL(context.req.url);

    return fetch(`http://127.0.0.1:4301${url.pathname}${url.search}`, {
      method: context.req.method,
      headers: context.req.raw.headers,
      ...(context.req.method === "GET"
        ? {}
        : { body: await context.req.text() }),
      signal: context.req.raw.signal,
    });
  });
  aegraFixture.api.get("/memory", (context) => {
    const url = new URL(context.req.url);

    return fetch(`http://127.0.0.1:4301/memory${url.search}`, {
      headers: context.req.raw.headers,
      signal: context.req.raw.signal,
    });
  });
  upstream = await new Promise<Server>((resolve) => {
    const server = serve(
      {
        fetch: aegraFixture.api.fetch,
        hostname: "127.0.0.1",
        port: 0,
      },
      () => resolve(server as Server),
    );
  });
  const address = upstream.address();

  if (!address || typeof address === "string") {
    throw new Error("Unable to find the controlled Aegra port");
  }

  process.env.AEGRA_URL = `http://127.0.0.1:${address.port}`;
  const { app } = await import("../../src/app.js");
  const { startExternalTaskWorker } =
    await import("../../src/conversation/tasks/task-worker.js");
  const { externalTasks } =
    await import("../../src/db/external-task-schema.js");
  const { conversationSnapshot } =
    await import("../../src/conversation/history/snapshot.js");

  stopWorker = startExternalTaskWorker();

  const harness = new Hono();
  let isReady = false;
  let isEmbeddingFailureEnabled = false;

  async function seedCompletedConversation(
    threadId: string,
    userMessage: Message,
    messages: LangGraphPlatformMessage[],
  ) {
    // Replace all archived messages atomically before exposing the fixture state.
    await databaseModule.db.transaction(async (transaction) => {
      await transaction
        .delete(conversationMessages)
        .where(eq(conversationMessages.threadId, threadId));

      const publicMessages = [userMessage, ...completedMessages({ messages })];

      await transaction.insert(conversationMessages).values(
        publicMessages.map((message, messageOrder) => ({
          threadId,
          messageId: message.id,
          submitSeq: 1,
          messageOrder,
          message,
        })),
      );
    });
    aegraFixture.seedConversation(threadId, messages);
  }

  process.env.WORKFLOW_API_TOKEN = "knowledge-e2e-token";
  harness.post("/__e2e/memory/:threadId", async (context) => {
    return fetch(
      `http://127.0.0.1:4301/__e2e/memory/${context.req.param("threadId")}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: await context.req.text(),
        signal: context.req.raw.signal,
      },
    );
  });
  harness.get("/health", (context) =>
    context.text(isReady ? "ok" : "starting", isReady ? 200 : 503),
  );
  harness.post("/__e2e/embedding-failure", async (context) => {
    isEmbeddingFailureEnabled = z
      .object({ enabled: z.boolean() })
      .parse(await context.req.json()).enabled;

    return context.json({ enabled: isEmbeddingFailureEnabled });
  });
  harness.post("/__e2e/embeddings", async (context) => {
    if (isEmbeddingFailureEnabled) {
      context.header("Retry-After", "0.05");

      return context.json(
        { error: { message: "Allocated quota exceeded" } },
        429,
      );
    }

    const input = z
      .object({
        input: z.union([z.string(), z.array(z.string())]),
        model: z.string(),
      })
      .parse(await context.req.json());
    const texts = Array.isArray(input.input) ? input.input : [input.input];

    return context.json({
      object: "list",
      model: input.model,
      usage: { prompt_tokens: 1, total_tokens: 1 },
      data: texts.map((text, index) => ({
        object: "embedding",
        index,
        embedding: /return/i.test(text) ? [1, 0.1] : [0.1, 1],
      })),
    });
  });
  harness.post("/__e2e/knowledge-result/:threadId", async (context) => {
    const threadId = context.req.param("threadId");
    const query = "What is the return policy?";
    const userMessageId = randomUUID();

    const search = await fetch("http://127.0.0.1:4301/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(KNOWLEDGE_SEARCH_TIMEOUT_MS),
    });

    const result = knowledgeSearchSchema.parse(await search.json());
    const passages = result.sources.map((source) => {
      const citation =
        source.citation ?? `[source](${knowledgeCitationUrl(source.chunkId)})`;

      return `A matching policy passage ${citation}.`;
    });

    const messages: LangGraphPlatformMessage[] = [
      {
        id: userMessageId,
        type: "human",
        role: "user",
        content: query,
      },
      {
        id: randomUUID(),
        type: "ai",
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "knowledge-search",
            name: "search_knowledge",
            args: { query },
          },
        ],
      },
      {
        id: randomUUID(),
        type: "tool",
        role: "tool",
        name: "search_knowledge",
        tool_call_id: "knowledge-search",
        content: JSON.stringify(result),
      },
      {
        id: randomUUID(),
        type: "ai",
        role: "assistant",
        content:
          passages.join("\n\n") || "No matching policy passages were found.",
      },
    ];

    await seedCompletedConversation(
      threadId,
      {
        id: userMessageId,
        role: "user",
        content: query,
      },
      messages,
    );

    return context.json(result);
  });

  harness.post("/__e2e/skill-result/:threadId", async (context) => {
    const threadId = context.req.param("threadId");
    const input: unknown = await context.req.json();
    const file = skillFileSchema.parse(input);

    if (file.threadId !== threadId) {
      return context.json({ error: "Wrong conversation" }, 400);
    }

    const userMessageId = randomUUID();
    const request = "Read the uploaded CSV.";
    const messages: LangGraphPlatformMessage[] = [
      {
        id: userMessageId,
        type: "human",
        role: "user",
        content: request,
      },
      {
        id: randomUUID(),
        type: "ai",
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "skill-fixture-call",
            name: "run_skill_script",
            args: {
              skill_name: "csv-summary",
              script_path: "scripts/summarize.py",
            },
          },
        ],
      },
      {
        id: randomUUID(),
        type: "tool",
        role: "tool",
        name: "run_skill_script",
        tool_call_id: "skill-fixture-call",
        content: JSON.stringify({
          kind: "skill_script_result",
          exitCode: 0,
          stdout: "done",
          stderr: "",
          error: null,
          files: [file],
        }),
      },
      {
        id: randomUUID(),
        type: "ai",
        role: "assistant",
        content: "The file is available.",
      },
    ];

    await seedCompletedConversation(
      threadId,
      {
        id: userMessageId,
        role: "user",
        content: request,
      },
      messages,
    );

    return context.json({ threadId });
  });
  harness.post("/__e2e/scroll-history", async (context) => {
    const threadId = randomUUID();
    const messages = scrollHistory();

    await databaseModule.db.transaction(async (transaction) => {
      await transaction
        .insert(conversations)
        .values({ threadId, title: "Scroll history" });
      await transaction.insert(conversationMessages).values(
        messages.map((message, messageOrder) => ({
          threadId,
          messageId: message.id,
          submitSeq: 0,
          messageOrder,
          message: {
            id: message.id,
            role: message.role,
            content: message.content,
          },
        })),
      );
    });
    aegraFixture.seedConversation(threadId, messages);

    return context.json({ threadId });
  });
  harness.post("/__e2e/release/:threadId", (context) => {
    const isReleased = aegraFixture.release(context.req.param("threadId"));

    return context.json({ released: isReleased }, isReleased ? 200 : 404);
  });
  harness.get("/__e2e/external-task/:threadId", async (context) => {
    const [task] = await databaseModule.db
      .select()
      .from(externalTasks)
      .where(eq(externalTasks.threadId, context.req.param("threadId")));

    return context.json(
      task ? { taskId: task.taskId, callbackToken: task.callbackToken } : null,
    );
  });
  harness.get("/__e2e/stored-conversation/:threadId", async (context) =>
    context.json(await conversationSnapshot(context.req.param("threadId"))),
  );
  harness.route("/", app);
  backend = serve({
    fetch: harness.fetch,
    hostname: "127.0.0.1",
    port: 4300,
  }) as Server;

  const root = fileURLToPath(new URL("../../..", import.meta.url));
  const python =
    process.platform === "win32"
      ? join(root, ".venv", "Scripts", "python.exe")
      : join(root, ".venv", "bin", "python");

  configurationDirectory = await mkdtemp(
    join(tmpdir(), "agent-configuration-"),
  );
  const modelConfigPath = join(configurationDirectory, "models.yaml");
  const agentConfigPath = join(configurationDirectory, "agent.yaml");

  // JSON is valid YAML; this owned fixture never reads a developer's model keys.
  await writeFile(
    modelConfigPath,
    JSON.stringify({
      chat: {
        default: "deepseek",
        models: {
          deepseek: {
            provider: "deepseek",
            label: "DeepSeek",
            model: "deepseek-flash",
            api_key: "",
            max_output_tokens: 4096,
            thinking: "disabled",
          },
        },
      },
      embedding: {
        base_url: "http://127.0.0.1:4300/__e2e",
        model: "controlled-model",
        api_key: "controlled-key",
        tokens_per_minute: 1000000,
        requests_per_minute: 24000,
        max_retries: 1,
        index_timeout: 600,
      },
    }),
    { mode: 0o600 },
  );
  await writeFile(
    agentConfigPath,
    JSON.stringify({
      database: {
        aegra_url: postgres.getConnectionUri(),
        application_url: postgres.getConnectionUri(),
      },
      redis: {
        url: `redis://${redis.getHost()}:${redis.getMappedPort(REDIS_PORT)}/0`,
      },
      workflow: {
        app_api_url: "http://127.0.0.1:4300",
        api_token: process.env.WORKFLOW_API_TOKEN ?? "",
      },
    }),
    { mode: 0o600 },
  );

  knowledgeProcess = spawn(
    python,
    [
      "-m",
      "uvicorn",
      "knowledge_server:app",
      // Match Aegra's psycopg-compatible loop when bypassing its CLI.
      "--loop",
      "aegra_api.utils.event_loop:selector_loop_factory",
      "--app-dir",
      join(root, "tests"),
      "--host",
      "127.0.0.1",
      "--port",
      "4301",
      "--log-level",
      "warning",
    ],
    {
      cwd: root,
      stdio: [...KNOWLEDGE_WORKER_STDIO],
      env: {
        ...process.env,
        PYTHONPATH: root,
        MODELS_CONFIG_PATH: modelConfigPath,
        AGENT_CONFIG_PATH: agentConfigPath,
      },
    },
  );
  let processError: Error | undefined;

  knowledgeProcess.on("error", (error) => {
    processError = error;
  });

  for (let attempt = 0; attempt < KNOWLEDGE_STARTUP_ATTEMPTS; attempt++) {
    if (processError || knowledgeProcess.exitCode !== null) {
      throw (
        processError ?? new Error("Knowledge test worker exited during startup")
      );
    }

    const response = await fetch("http://127.0.0.1:4301/health").catch(
      () => undefined,
    );

    if (response?.ok) {
      isReady = true;
      break;
    }

    await new Promise((resolve) =>
      setTimeout(resolve, KNOWLEDGE_STARTUP_INTERVAL_MS),
    );
  }

  if (!isReady) {
    throw new Error("Knowledge test worker did not start");
  }

  stopKnowledgeCleanup = (
    await import("../../src/knowledge/cleanup.js")
  ).startKnowledgeCleanup();
}

function reportFailure(error: unknown) {
  console.error(error);
  process.exitCode = 1;
}

const starting = start();

for (const signal of SHUTDOWN_SIGNALS) {
  process.once(signal, () => {
    // A signal during startup must still release resources created afterwards.
    void starting.catch(() => undefined).then(stop);
  });
}

try {
  await starting;
} catch (error) {
  reportFailure(error);
  await stop();
}
