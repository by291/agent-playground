import { startKnowledgeCleanup } from "./knowledge/cleanup.js";
import type { Server } from "node:http";
import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { db, migrateServer } from "./db/database.js";
import { startExternalTaskWorker } from "./conversation/external-task-worker.js";
import { logger } from "./observability/logger";

import { startSkillFileCleanup } from "./conversation/skill-file-cleanup.js";
import { closeObjectStore } from "./storage/object-store.js";

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
  await Promise.all([
    workerStopped,
    serverClosed,
    stopFileCleanup(),
    stopKnowledgeCleanup(),
  ]);
  closeObjectStore();
  await db.$client.end();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdown().catch((error: unknown) => {
      logger.error({ err: error }, "Server shutdown failed");
      process.exitCode = 1;
    });
  });
}
