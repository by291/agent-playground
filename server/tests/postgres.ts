import { PostgreSqlContainer } from "@testcontainers/postgresql";
import type { TestProject } from "vitest/node";

export default async function setup(project: TestProject) {
  const postgres = await new PostgreSqlContainer(
    "pgvector/pgvector:0.8.7-pg18",
  ).start();

  project.provide("postgresUrl", postgres.getConnectionUri());

  return async () => {
    await postgres.stop();
  };
}
