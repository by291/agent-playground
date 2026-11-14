import assert from "node:assert/strict";
import { test } from "vitest";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { fileURLToPath } from "node:url";
import { createIntegrationDatabase } from "../../tests/database.js";

test("concurrent startup applies each migration once", async () => {
  const testDatabase = await createIntegrationDatabase();

  process.env.APP_DATABASE_URL = testDatabase.url;

  const { db, migrateServer } = await import("./database.js");

  try {
    // Both startup attempts use separate sessions and a fresh migration journal.
    await Promise.all([migrateServer(), migrateServer()]);

    const migrationsFolder = fileURLToPath(
      new URL("../../drizzle", import.meta.url),
    );
    const expected = readMigrationFiles({ migrationsFolder });
    const journal = await db.$client.query<{ hash: string }>(
      "SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at",
    );

    assert.deepEqual(
      journal.rows.map(({ hash }) => hash),
      expected.map(({ hash }) => hash),
    );
  } finally {
    await db.$client.end();
    await testDatabase.dispose();
  }
});
