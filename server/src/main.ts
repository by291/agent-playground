import { startKnowledgeCleanup } from "./knowledge/cleanup.js";
import type { Server } from "node:http";
import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { db, migrateServer } from "./db/database.js";
import { startExternalTaskWorker } from "./conversation/tasks/task-worker.js";
import { logger } from "./observability/logger.js";

import { startSkillFileCleanup } from "./conversation/files/skill-file-cleanup.js";
import { closeObjectStore } from "./storage/object-store.js";
import { shutdownTelemetry } from "./observability/bootstrap.js";
import { closeConversationChanges } from "./conversation/events/subscription.js";

const port = Number(process.env.SERVER_PORT ?? 3000);

await migrateServer();

const stopWorker = startExternalTaskWorker();
const stopFileCleanup = startSkillFileCleanup();
const stopKnowledgeCleanup = startKnowledgeCleanup();
const server = serve({ fetch: app.fetch, hostname: "0.0.0.0", port }, () => {
  logger.info({ port }, "AG-UI server listening");
}) as Server;
let stopping = false;

async function shutdown() {
  if (stopping) {
    return;
  }

  stopping = true;

  // Stop accepting work and drain its owners before closing their shared clients.
  const workerStopped = stopWorker();
  const serverClosed = new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });

  server.closeAllConnections();

  const failures: unknown[] = [];
  const drainResults = await Promise.allSettled([
    workerStopped,
    serverClosed,
    stopFileCleanup(),
    stopKnowledgeCleanup(),
    closeConversationChanges(),
  ]);

  for (const result of drainResults) {
    if (result.status === "rejected") {
      failures.push(result.reason);
    }
  }

  try {
    closeObjectStore();
  } catch (error) {
    failures.push(error);
  }

  try {
    await db.$client.end();
  } catch (error) {
    failures.push(error);
  }

  // Export the work produced while draining every application resource.
  try {
    await shutdownTelemetry();
  } catch (error) {
    failures.push(error);
  }

  if (failures.length) {
    throw new AggregateError(failures, "Server resources could not be closed");
  }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdown().catch((error: unknown) => {
      logger.error({ err: error }, "Server shutdown failed");
      process.exitCode = 1;
    });
  });
}
