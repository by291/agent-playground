import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import type { StartedTestContainer } from "testcontainers";
import {
  createIntegrationDatabase,
  type IntegrationDatabase,
} from "../../tests/database.js";
import { createSkillTestStorage } from "../../tests/skill-storage.js";

let storage: StartedTestContainer;
let testDatabase: IntegrationDatabase;
let database: typeof import("../db/database.js");
let schema: typeof import("../db/knowledge-schema.js");
let app: (typeof import("../app.js"))["app"];

beforeAll(async () => {
  storage = await createSkillTestStorage();
  testDatabase = await createIntegrationDatabase();
  process.env.APP_DATABASE_URL = testDatabase.url;
  process.env.WORKFLOW_API_TOKEN = "knowledge-test-token";
  database = await import("../db/database.js");
  schema = await import("../db/knowledge-schema.js");
  await database.migrateServer();
  app = (await import("../app.js")).app;
});

afterAll(async () => {
  await database?.db.$client.end();
  await testDatabase?.dispose();
  (await import("../storage/object-store.js")).closeObjectStore();
  await storage?.stop();
});

const upload = (id: string, body = "Returns are allowed within 30 days.") =>
  app.request("/api/knowledge/documents", {
    method: "POST",
    headers: { "X-Filename": "policy.md", "X-Document-Id": id },
    body,
  });

test("shared uploads are idempotent, authenticated internally and deleted before cleanup", async () => {
  const id = randomUUID();
  const response = await upload(id);

  expect(response.status).toBe(201);
  expect(await response.json()).toMatchObject({
    id,
    status: "queued",
    chunkCount: 0,
  });
  expect((await upload(id)).status).toBe(201);
  expect((await upload(id, "different")).status).toBe(409);
  expect(
    (await app.request(`/internal/knowledge/documents/${id}/file`)).status,
  ).toBe(401);
  const internal = await app.request(
    `/internal/knowledge/documents/${id}/file`,
    { headers: { Authorization: "Bearer knowledge-test-token" } },
  );

  expect(await internal.text()).toContain("30 days");
  await database.db
    .update(schema.knowledgeDocuments)
    .set({ status: "ready", generation: "old", chunkCount: 1 })
    .where(eq(schema.knowledgeDocuments.id, id));
  await database.db.insert(schema.knowledgeChunks).values({
    langchainId: randomUUID(),
    documentId: id,
    generation: "old",
    embeddingProfile: "test",
    visible: true,
    content: "30 days",
    embedding: "[1,0]",
  });
  expect(
    (
      await app.request(`/api/knowledge/documents/${id}/reindex`, {
        method: "POST",
      })
    ).status,
  ).toBe(200);
  const [hidden] = await database.db
    .select()
    .from(schema.knowledgeChunks)
    .where(eq(schema.knowledgeChunks.documentId, id));

  expect(hidden!.visible).toBe(false);
  expect(
    (await app.request(`/api/knowledge/documents/${id}`, { method: "DELETE" }))
      .status,
  ).toBe(204);
  expect(
    (await app.request(`/api/knowledge/documents/${id}/file`)).status,
  ).toBe(404);
  expect((await upload(id)).status).toBe(404);
  const { cleanupDeletedDocuments } = await import("./cleanup.js");

  await cleanupDeletedDocuments();
  expect(await database.db.select().from(schema.knowledgeChunks)).toHaveLength(
    0,
  );
  const [deleted] = await database.db.select().from(schema.knowledgeDocuments);

  expect(deleted!.objectDeletedAt).not.toBeNull();
  expect((await upload(id)).status).toBe(404);
});

test("a failed object PUT keeps a recoverable upload intent", async () => {
  const id = randomUUID();
  const store = await import("../storage/object-store.js");
  const failedPut = vi
    .spyOn(store, "putObject")
    .mockRejectedValueOnce(new Error("storage offline"));

  expect((await upload(id)).status).toBe(503);
  failedPut.mockRestore();
  const documents = (await (
    await app.request("/api/knowledge/documents")
  ).json()) as { id: string; status: string }[];

  expect(documents.find((row) => row.id === id)?.status).toBe("uploading");
  expect((await upload(id)).status).toBe(201);
  expect(
    (
      await app.request(`/api/knowledge/documents/${id}/reindex`, {
        method: "POST",
      })
    ).status,
  ).toBe(409);
});

test("late object commits after deletion are reconciled and removed", async () => {
  const id = randomUUID();

  await upload(id);
  await app.request(`/api/knowledge/documents/${id}`, { method: "DELETE" });
  const { cleanupDeletedDocuments } = await import("./cleanup.js");
  const store = await import("../storage/object-store.js");

  await cleanupDeletedDocuments();
  // Model a remote PUT committing after the client timed out and DELETE finished.
  await store.putObject(`knowledge/${id}`, Buffer.from("late upload"));
  await cleanupDeletedDocuments();
  await expect(store.getObject(`knowledge/${id}`, 11)).rejects.toThrow();
  expect((await upload(id)).status).toBe(404);
});

test("invalid and oversized uploads are rejected before creating an intent", async () => {
  const before = await database.db.select().from(schema.knowledgeDocuments);

  for (const name of ["../policy.md", "data.csv", "bad\n.pdf"]) {
    const response = await app.request("/api/knowledge/documents", {
      method: "POST",
      headers: {
        "X-Filename": encodeURIComponent(name),
        "X-Document-Id": randomUUID(),
      },
      body: "text",
    });

    expect(response.status).toBe(400);
  }

  expect((await upload(randomUUID(), "")).status).toBe(400);
  expect(
    (await upload(randomUUID(), "x".repeat(10 * 1024 * 1024 + 1))).status,
  ).toBe(413);
  expect(
    await database.db.select().from(schema.knowledgeDocuments),
  ).toHaveLength(before.length);
});

test("text encoding survives reindex retries and can be reset to automatic detection", async () => {
  const id = randomUUID();

  await upload(id);
  await database.db
    .update(schema.knowledgeDocuments)
    .set({ status: "failed", generation: "previous" })
    .where(eq(schema.knowledgeDocuments.id, id));
  const reindex = (encoding?: string) =>
    app.request(`/api/knowledge/documents/${id}/reindex`, {
      method: "POST",
      headers: encoding ? { "X-Text-Encoding": encoding } : {},
    });
  const chosen = await reindex("gbk");

  expect(chosen.status).toBe(200);
  expect(await chosen.json()).toMatchObject({
    textEncoding: "gbk",
    status: "queued",
  });
  expect((await reindex("big5")).status).toBe(409);
  await database.db
    .update(schema.knowledgeDocuments)
    .set({ status: "failed" })
    .where(eq(schema.knowledgeDocuments.id, id));

  expect(await (await reindex()).json()).toMatchObject({ textEncoding: "gbk" });
  await database.db
    .update(schema.knowledgeDocuments)
    .set({ status: "ready" })
    .where(eq(schema.knowledgeDocuments.id, id));

  expect(await (await reindex("auto")).json()).toMatchObject({
    textEncoding: null,
  });
  const [stored] = await database.db
    .select()
    .from(schema.knowledgeDocuments)
    .where(eq(schema.knowledgeDocuments.id, id));

  expect(stored!.textEncoding).toBeNull();
  await app.request(`/api/knowledge/documents/${id}`, { method: "DELETE" });
});

test("unsupported encodings and PDF encoding overrides do not admit uploads", async () => {
  const before = await database.db.select().from(schema.knowledgeDocuments);

  for (const [name, encoding] of [
    ["policy.md", "utf-7"],
    ["policy.pdf", "gbk"],
  ]) {
    const response = await app.request("/api/knowledge/documents", {
      method: "POST",
      headers: {
        "X-Filename": name!,
        "X-Document-Id": randomUUID(),
        "X-Text-Encoding": encoding!,
      },
      body: "text",
    });

    expect(response.status).toBe(400);
  }

  expect(
    await database.db.select().from(schema.knowledgeDocuments),
  ).toHaveLength(before.length);
});

test("unfinished uploads preserve their encoding when resumed without an override", async () => {
  const id = randomUUID();
  const store = await import("../storage/object-store.js");
  const failedPut = vi
    .spyOn(store, "putObject")
    .mockRejectedValueOnce(new Error("offline"));
  const response = await app.request("/api/knowledge/documents", {
    method: "POST",
    headers: {
      "X-Filename": "policy.md",
      "X-Document-Id": id,
      "X-Text-Encoding": "gbk",
    },
    body: "Returns are allowed within 30 days.",
  });

  expect(response.status).toBe(503);
  failedPut.mockRestore();
  const resumed = await upload(id);

  expect(resumed.status).toBe(201);
  expect(await resumed.json()).toMatchObject({
    textEncoding: "gbk",
    status: "queued",
  });
  await app.request(`/api/knowledge/documents/${id}`, { method: "DELETE" });
});
