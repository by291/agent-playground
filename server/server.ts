import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { migrateServer } from "./db/database.js";
import { logger } from "./observability/logger";

const port = Number(process.env.SERVER_PORT ?? 3000);

await migrateServer();

serve({ fetch: app.fetch, hostname: "0.0.0.0", port }, () => {
  logger.info({ port }, "AG-UI server listening");
});
