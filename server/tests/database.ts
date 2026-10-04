import { randomUUID } from "node:crypto";
import pg from "pg";
import { inject } from "vitest";

declare module "vitest" {
  export interface ProvidedContext {
    postgresUrl: string;
  }
}

export interface IntegrationDatabase {
  url: string;
  dispose(): Promise<void>;
}

async function executeAdminQuery(connectionString: string, statement: string) {
  const client = new pg.Client({ connectionString });

  try {
    await client.connect();
    await client.query(statement);
  } finally {
    await client.end();
  }
}

export async function createIntegrationDatabase(): Promise<IntegrationDatabase> {
  const adminUrl = inject("postgresUrl");
  const name = `test_${randomUUID().replaceAll("-", "")}`;

  await executeAdminQuery(adminUrl, `CREATE DATABASE "${name}"`);
  const url = new URL(adminUrl);

  url.pathname = `/${name}`;

  return {
    url: url.toString(),
    async dispose() {
      // File-owned pools must close before dropping their isolated database.
      await executeAdminQuery(adminUrl, `DROP DATABASE "${name}"`);
    },
  };
}
