import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { migrateServer } from "./db/database.js";

const port = Number(process.env.SERVER_PORT ?? 3000);

await migrateServer();

serve({ fetch: app.fetch, hostname: "0.0.0.0", port }, () => {
  console.log(`AG-UI server listening on port ${port}`);
});
