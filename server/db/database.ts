import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.APP_DATABASE_URL });
export const db = drizzle({ client: pool });

export async function migrateServer(): Promise<void> {
  if (!process.env.APP_DATABASE_URL) {
    throw new Error("APP_DATABASE_URL is required");
  }
  const migrationsFolder = new URL("../drizzle", import.meta.url).pathname;
  await migrate(db, { migrationsFolder });
}
