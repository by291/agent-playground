import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { fileURLToPath } from "node:url";
import { logger } from "../observability/logger.js";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.APP_DATABASE_URL });

pool.on("error", (error) => {
  // pg removes failed idle clients before emitting; the next query gets a fresh client.
  logger.error(
    { err: error },
    "Idle database connection failed; the pool will replace it",
  );
});

export const db = drizzle({ client: pool });

export async function migrateServer(): Promise<void> {
  if (!process.env.APP_DATABASE_URL) {
    throw new Error("APP_DATABASE_URL is required");
  }

  const migrationsFolder = fileURLToPath(
    new URL("../../drizzle", import.meta.url),
  );

  await migrate(db, { migrationsFolder });
}
