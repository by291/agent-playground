import { PostgreSqlContainer } from "@testcontainers/postgresql";
import type { TestProject } from "vitest/node";

export default async function setup(project: TestProject) {
  const postgres = await new PostgreSqlContainer("postgres:18-alpine").start();

  project.provide("postgresUrl", postgres.getConnectionUri());

  return async () => {
    await postgres.stop();
  };
}
