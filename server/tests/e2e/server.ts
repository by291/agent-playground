import { serve } from "@hono/node-server";
import type { Server } from "node:http";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { controlledAegra } from "./aegra";

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
    await stopWorker?.();

    try {
      await closeServer(backend);
    } finally {
      try {
        await closeServer(upstream);
      } finally {
        try {
          await database?.db.$client.end();
        } finally {
          await postgres?.stop();
        }
      }
    }
  })();

  return stopping;
}

async function start() {
  postgres = await new PostgreSqlContainer("postgres:18-alpine").start();
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
