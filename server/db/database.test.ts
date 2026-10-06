import { afterAll, afterEach, expect, test, vi } from "vitest";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, migrateServer } from "./database.js";

vi.mock("drizzle-orm/node-postgres/migrator", () => ({ migrate: vi.fn() }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

afterAll(async () => {
  await db.$client.end();
});

test("server migration loads the committed SQL files from the native filesystem", async () => {
  vi.stubEnv("APP_DATABASE_URL", "postgres://unused/unused");
  let migrations: ReturnType<typeof readMigrationFiles> = [];

  vi.mocked(migrate).mockImplementation((_database, configuration) => {
    migrations = readMigrationFiles(configuration);

    return Promise.resolve();
  });

  await migrateServer();

  expect(migrations.length).toBeGreaterThan(0);
  expect(migrations.every(({ sql }) => sql.length > 0)).toBe(true);
});
