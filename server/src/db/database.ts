import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { fileURLToPath } from "node:url";
import { logger } from "../observability/logger.js";

const MIGRATION_LOCK_NAME = "agent-playground-server-schema";

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

/** Apply committed migrations with one replica holding the schema lock. */
export async function migrateServer(): Promise<void> {
  if (!process.env.APP_DATABASE_URL) {
    throw new Error("APP_DATABASE_URL is required");
  }

  const migrationsFolder = fileURLToPath(
    new URL("../../drizzle", import.meta.url),
  );

  const client = await pool.connect();
  let isReusable = false;

  try {
    // Drizzle reads the migration journal before its own transaction. Keep the
    // session lock across that read and the DDL using this same connection.
    await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [
      MIGRATION_LOCK_NAME,
    ]);
    await migrate(drizzle({ client }), { migrationsFolder });
    await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [
      MIGRATION_LOCK_NAME,
    ]);
    isReusable = true;
  } finally {
    // A failed migration or unlock must not return a session still holding the lock.
    if (isReusable) {
      client.release();
    } else {
      client.release(new Error("Discarding the migration connection"));
    }
  }
}
