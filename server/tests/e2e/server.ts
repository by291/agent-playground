import { z } from "zod";
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  knowledgeCitationUrl,
  knowledgeSearchSchema,
} from "../../../shared/knowledge";
import { createSkillTestStorage } from "../skill-storage";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { skillFileSchema } from "../../../shared/skill-files";
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
import { completedMessages } from "../../agent/messages";
import { controlledAegra } from "./aegra";
import { randomUUID } from "node:crypto";
import { conversations, conversationMessages } from "../../db/schema";
import { scrollHistory } from "./scroll-history";

let knowledgeProcess: ChildProcess | undefined;
let stopKnowledgeCleanup: (() => Promise<void>) | undefined;
let storage: StartedTestContainer | undefined;
let redis: StartedTestContainer | undefined;
let postgres: StartedPostgreSqlContainer | undefined;
let database: typeof import("../../db/database") | undefined;
let upstream: Server | undefined;
let backend: Server | undefined;
let agent: ReturnType<typeof controlledAegra> | undefined;
let stopping: Promise<void> | undefined;
let stopWorker: (() => Promise<void>) | undefined;

async function closeServer(server: Server | undefined) {
  if (!server?.listening) {
    return;
  }

  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

function stop() {
  stopping ??= (async () => {
    agent?.releaseAll();

    if (
      knowledgeProcess?.pid &&
      knowledgeProcess.exitCode === null &&
      knowledgeProcess.signalCode === null
    ) {
      const process = knowledgeProcess;
      const exited = new Promise<void>((resolve) =>
        process.once("exit", () => resolve()),
      );
      const timeout = setTimeout(() => process.kill("SIGKILL"), 5000);

      process.kill("SIGTERM");
      await exited;
      clearTimeout(timeout);
    }

    await stopWorker?.();
    await stopKnowledgeCleanup?.();

    try {
      await closeServer(backend);
    } finally {
      try {
        await closeServer(upstream);
      } finally {
        try {
          await database?.db.$client.end();
        } finally {
          try {
            await postgres?.stop();
          } finally {
            try {
              (await import("../../storage/object-store")).closeObjectStore();
              await storage?.stop();
            } finally {
              await redis?.stop();
            }
          }
        }
      }
    }
  })();

  return stopping;
}

async function start() {
  storage = await createSkillTestStorage();
  redis = await new GenericContainer("redis:8-alpine")
    .withExposedPorts(6379)
    .start();
  postgres = await new PostgreSqlContainer(
    "pgvector/pgvector:0.8.7-pg18",
  ).start();
  process.env.APP_DATABASE_URL = postgres.getConnectionUri();
  database = await import("../../db/database");
  await database.migrateServer();
  // Python owns this table. Match its read contract in the isolated test DB.
  await database.db.execute(sql`
    CREATE TABLE workflow_outputs (
      id text PRIMARY KEY, thread_id text NOT NULL, agui_run_id text NOT NULL,
      workflow_call_id text NOT NULL, step_id text NOT NULL, step_seq integer NOT NULL,
      output_seq bigint NOT NULL, kind text NOT NULL DEFAULT 'a2ui', version integer NOT NULL DEFAULT 1,
      payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (thread_id, workflow_call_id, step_id, version), UNIQUE (thread_id, output_seq)
    )
  `);
  agent = controlledAegra(database.db);
  upstream = await new Promise<Server>((resolve) => {
    const server = serve(
      { fetch: agent!.api.fetch, hostname: "127.0.0.1", port: 0 },
      () => resolve(server as Server),
    );
  });
  const address = upstream.address();

  if (!address || typeof address === "string") {
    throw new Error("Unable to find the controlled Aegra port");
  }

  process.env.AEGRA_URL = `http://127.0.0.1:${address.port}`;
  const { app } = await import("../../app");
  const { startExternalTaskWorker } =
    await import("../../conversation/external-task-worker");
  const { externalTasks } = await import("../../db/external-task-schema");
  const { conversationSnapshot } =
    await import("../../conversation/conversation-snapshot");

  stopWorker = startExternalTaskWorker();
  const harness = new Hono();
  let ready = false;
  let embeddingFailure = false;

  process.env.WORKFLOW_API_TOKEN = "knowledge-e2e-token";
  harness.get("/health", (context) =>
    context.text(ready ? "ok" : "starting", ready ? 200 : 503),
  );
  harness.post("/__e2e/embedding-failure", async (context) => {
    embeddingFailure = z
      .object({ enabled: z.boolean() })
      .parse(await context.req.json()).enabled;

    return context.json({ enabled: embeddingFailure });
  });
  harness.post("/__e2e/embeddings", async (context) => {
    if (embeddingFailure) {
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
    const search = await fetch("http://127.0.0.1:4301/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(10_000),
    });
    const result = knowledgeSearchSchema.parse(await search.json());
    const messages: LangGraphPlatformMessage[] = [
      { id: randomUUID(), type: "human", role: "user", content: query },
      {
        id: randomUUID(),
        type: "ai",
        role: "assistant",
        content: "",
        tool_calls: [
          { id: "knowledge-search", name: "search_knowledge", args: { query } },
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
          result.sources
            .map(
              (source) =>
                `A matching policy passage ${source.citation ?? `[source](${knowledgeCitationUrl(source.chunkId)})`}.`,
            )
            .join("\n\n") || "No matching policy passages were found.",
      },
    ];

    await database!.db.transaction(async (tx) => {
      await tx
        .delete(conversationMessages)
        .where(eq(conversationMessages.threadId, threadId));
      const publicMessages: Message[] = [
        { id: messages[0]!.id!, role: "user", content: query },
        ...completedMessages({ messages }),
      ];

      await tx.insert(conversationMessages).values(
        publicMessages.map((message, messageOrder) => ({
          threadId,
          messageId: message.id,
          submitSeq: 1,
          messageOrder,
          message,
        })),
      );
    });
    agent!.seedConversation(threadId, messages);

    return context.json(result);
  });

  harness.post("/__e2e/skill-result/:threadId", async (context) => {
    const threadId = context.req.param("threadId");
    const input: unknown = await context.req.json();
    const file = skillFileSchema.parse(input);

    if (file.threadId !== threadId) {
      return context.json({ error: "Wrong conversation" }, 400);
    }

    const messages: LangGraphPlatformMessage[] = [
      {
        id: randomUUID(),
        type: "human",
        role: "user",
        content: "Read the uploaded CSV.",
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

    await database!.db.transaction(async (tx) => {
      await tx
        .delete(conversationMessages)
        .where(eq(conversationMessages.threadId, threadId));
      const publicMessages: Message[] = [
        {
          id: messages[0]!.id!,
          role: "user",
          content: "Read the uploaded CSV.",
        },
        ...completedMessages({ messages }),
      ];

      await tx.insert(conversationMessages).values(
        publicMessages.map((message, messageOrder) => ({
          threadId,
          messageId: message.id,
          submitSeq: 1,
          messageOrder,
          message,
        })),
      );
    });
    agent!.seedConversation(threadId, messages);

    return context.json({ threadId });
  });
  harness.post("/__e2e/scroll-history", async (context) => {
    const threadId = randomUUID();
    const messages = scrollHistory();

    await database!.db.transaction(async (tx) => {
      await tx
        .insert(conversations)
        .values({ threadId, title: "Scroll history" });
      await tx.insert(conversationMessages).values(
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
    agent!.seedConversation(threadId, messages);

    return context.json({ threadId });
  });
  harness.post("/__e2e/release/:threadId", (context) => {
    const released = agent!.release(context.req.param("threadId"));

    return context.json({ released }, released ? 200 : 404);
  });
  harness.get("/__e2e/external-task/:threadId", async (context) => {
    const [task] = await database!.db
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
      stdio: ["ignore", "ignore", "inherit"],
      env: {
        ...process.env,
        PYTHONPATH: root,
        APP_API_URL: "http://127.0.0.1:4300",
        REDIS_URL: `redis://${redis.getHost()}:${redis.getMappedPort(6379)}/0`,
        RAG_EMBEDDING_BASE_URL: "http://127.0.0.1:4300/__e2e",
        RAG_EMBEDDING_MODEL: "controlled-model",
        RAG_EMBEDDING_API_KEY: "controlled-key",
        RAG_EMBEDDING_DIMENSIONS: "",
        RAG_EMBEDDING_TPM: "1000000",
        RAG_EMBEDDING_RPM: "24000",
        RAG_EMBEDDING_MAX_RETRIES: "1",
        RAG_INDEX_TIMEOUT_SECONDS: "600",
        RAG_EMBEDDING_QUOTA_SCOPE: "",
      },
    },
  );
  let processError: Error | undefined;

  knowledgeProcess.on("error", (error) => {
    processError = error;
  });

  for (let attempt = 0; attempt < 100; attempt++) {
    if (processError || knowledgeProcess.exitCode !== null) {
      throw (
        processError ?? new Error("Knowledge test worker exited during startup")
      );
    }

    const response = await fetch("http://127.0.0.1:4301/health").catch(
      () => undefined,
    );

    if (response?.ok) {
      ready = true;
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  if (!ready) {
    throw new Error("Knowledge test worker did not start");
  }

  stopKnowledgeCleanup = (
    await import("../../knowledge/cleanup")
  ).startKnowledgeCleanup();
}

const starting = start();

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    // A signal during startup must still release resources created afterwards.
    void starting
      .catch(() => undefined)
      .then(stop)
      .catch((error: unknown) => {
        console.error(error);
        process.exitCode = 1;
      });
  });
}

try {
  await starting;
} catch (error) {
  console.error(error);
  process.exitCode = 1;
  await stop();
}
