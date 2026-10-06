import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { fileURLToPath } from "node:url";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.APP_DATABASE_URL });

export const db = drizzle({ client: pool });

export async function migrateServer(): Promise<void> {
  if (!process.env.APP_DATABASE_URL) {
    throw new Error("APP_DATABASE_URL is required");
  }

  const migrationsFolder = fileURLToPath(
    new URL("../drizzle", import.meta.url),
  );

  await migrate(db, { migrationsFolder });
}
