import { createSkillTestStorage } from "../tests/skill-storage";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { type StartedTestContainer } from "testcontainers";
import {
  S3Client,
  GetObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, test, vi } from "vitest";
import {
  createIntegrationDatabase,
  type IntegrationDatabase,
} from "../tests/database";

let storage: StartedTestContainer;
let s3: S3Client;
let testDatabase: IntegrationDatabase;
let database: typeof import("../db/database");
let schema: typeof import("../db/schema");
let app: (typeof import("../app"))["app"];

beforeAll(async () => {
  storage = await createSkillTestStorage();
  s3 = new S3Client({
    endpoint: process.env.S3_ENDPOINT!,
    region: "us-east-1",
    forcePathStyle: true,
  });
  testDatabase = await createIntegrationDatabase();
  process.env.APP_DATABASE_URL = testDatabase.url;
  process.env.WORKFLOW_API_TOKEN = "skill-file-test-token";
  database = await import("../db/database");
  schema = await import("../db/schema");
  await database.migrateServer();
  app = (await import("../app")).app;
});

afterAll(async () => {
  try {
    await database?.db.$client.end();
  } finally {
    await testDatabase?.dispose();
    (await import("../storage/object-store")).closeObjectStore();
    s3?.destroy();
    await storage?.stop();
  }
});

async function upload(
  threadId: string,
  name = "orders.csv",
  content = "amount\n12\n8\n",
) {
  const id = randomUUID();
  const response = await app.request(`/conversations/${threadId}/files`, {
    method: "POST",
    headers: { "X-Filename": encodeURIComponent(name), "X-File-Id": id },
    body: content,
  });

  return { id, response };
}

test("uploads preserve bytes, reject cross-conversation reads and disappear after deletion", async () => {
  const threadId = randomUUID();
  const { id, response } = await upload(threadId);

  assert.equal(response.status, 201);
  const { skillFiles } = await import("../db/skill-file-schema");
  const [metadata] = await database.db
    .select()
    .from(skillFiles)
    .where(eq(skillFiles.id, id));
  const object = await s3.send(
    new GetObjectCommand({ Bucket: "skill-tests", Key: metadata!.objectKey }),
  );

  assert.equal(await object.Body!.transformToString(), "amount\n12\n8\n");
  assert.equal(metadata!.ready, true);
  const download = await app.request(`/conversations/${threadId}/files/${id}`);

  assert.equal(download.status, 200);
  assert.equal(await download.text(), "amount\n12\n8\n");
  assert.match(download.headers.get("Content-Disposition") ?? "", /attachment/);
  assert.equal(download.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(
    (await app.request(`/conversations/${randomUUID()}/files/${id}`)).status,
    404,
  );
  assert.equal(
    (await app.request(`/internal/skill-files/${id}?threadId=${threadId}`))
      .status,
    401,
  );
  assert.equal(
    (await app.request(`/conversations/${threadId}`, { method: "DELETE" }))
      .status,
    204,
  );
  assert.equal(
    (await app.request(`/conversations/${threadId}/files/${id}`)).status,
    404,
  );
  assert.equal((await upload(threadId)).response.status, 404);
  const { cleanupDeletedSkillFiles } = await import("./skill-file-cleanup");
  const failure = vi
    .spyOn(S3Client.prototype, "send")
    .mockRejectedValueOnce(new Error("Storage offline"));

  await assert.rejects(cleanupDeletedSkillFiles(), /could not be deleted/);
  failure.mockRestore();
  assert.equal(
    (await database.db.select().from(skillFiles).where(eq(skillFiles.id, id)))
      .length,
    1,
  );
  await cleanupDeletedSkillFiles();
  const [tombstone] = await database.db
    .select()
    .from(skillFiles)
    .where(eq(skillFiles.id, id));

  assert.ok(tombstone!.objectDeletedAt);
  const objects = await s3.send(
    new ListObjectsV2Command({
      Bucket: "skill-tests",
      Prefix: metadata!.objectKey,
    }),
  );

  assert.equal(objects.KeyCount, 0);
});

test("output publication requires the owning run and repeated publication cannot overwrite bytes", async () => {
  const threadId = randomUUID();
  const runId = randomUUID();

  await database.db.insert(schema.conversations).values({ threadId });
  await database.db.insert(schema.conversationRuns).values({
    threadId,
    aguiRunId: runId,
    messageId: randomUUID(),
    submitSeq: 1,
    status: "running",
    request: {
      threadId,
      runId,
      messages: [],
      tools: [],
      context: [],
      state: {},
      forwardedProps: {},
    },
  });
  const body = {
    id: randomUUID(),
    threadId,
    runId,
    name: "summary.json",
    dataBase64: Buffer.from('{"total":20}').toString("base64"),
  };
  const publish = (input: object, authenticated = true) =>
    app.request("/internal/skill-files", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authenticated
          ? { Authorization: "Bearer skill-file-test-token" }
          : {}),
      },
      body: JSON.stringify(input),
    });

  assert.equal((await publish(body, false)).status, 401);
  assert.equal((await publish({ ...body, runId: randomUUID() })).status, 409);
  assert.equal(
    (await publish({ ...body, dataBase64: "not base64" })).status,
    400,
  );
  assert.equal((await publish(body)).status, 201);
  assert.equal((await publish(body)).status, 201);
  assert.equal((await publish({ ...body, dataBase64: "eA==" })).status, 409);
  const result = await app.request(
    `/conversations/${threadId}/files/${body.id}`,
  );

  assert.equal(await result.text(), '{"total":20}');
});

test("unsafe filenames and oversized payloads are rejected before storage", async () => {
  assert.equal((await upload(randomUUID(), "../secret")).response.status, 400);
  assert.equal(
    (await upload(randomUUID(), "bad\r\nname")).response.status,
    400,
  );
  assert.equal(
    (await upload(randomUUID(), "large.bin", "x".repeat(10 * 1024 * 1024 + 1)))
      .response.status,
    413,
  );
});

test("failed S3 upload is unreadable and can be retried with the same file ID", async () => {
  const threadId = randomUUID();
  const id = randomUUID();
  const request = () =>
    app.request(`/conversations/${threadId}/files`, {
      method: "POST",
      headers: { "X-Filename": "retry.txt", "X-File-Id": id },
      body: "recoverable",
    });
  const failure = vi
    .spyOn(S3Client.prototype, "send")
    .mockRejectedValueOnce(new Error("Storage offline"));

  assert.equal((await request()).status, 503);
  failure.mockRestore();
  assert.equal(
    (await app.request(`/conversations/${threadId}/files/${id}`)).status,
    404,
  );
  assert.equal((await request()).status, 201);
  assert.equal(
    await (await app.request(`/conversations/${threadId}/files/${id}`)).text(),
    "recoverable",
  );
});

test("failed first attachments retain retry identity without appearing in history before admission", async () => {
  const threadId = randomUUID();
  const id = randomUUID();
  const request = () =>
    app.request(`/conversations/${threadId}/files`, {
      method: "POST",
      headers: { "X-Filename": "first.txt", "X-File-Id": id },
      body: "recoverable attachment",
    });
  const failure = vi
    .spyOn(S3Client.prototype, "send")
    .mockRejectedValueOnce(new Error("Storage offline"));

  try {
    assert.equal((await request()).status, 503);
  } finally {
    failure.mockRestore();
  }

  const history = async () => {
    const response = await app.request("/conversations");

    return (await response.json()) as {
      conversations: { threadId: string; title: string }[];
    };
  };

  assert.equal(
    (await history()).conversations.some((row) => row.threadId === threadId),
    false,
  );
  assert.equal((await request()).status, 201);
  assert.equal(
    (await history()).conversations.some((row) => row.threadId === threadId),
    false,
  );
  const { admitRun } = await import("./run-store");
  const message = {
    id: randomUUID(),
    role: "user" as const,
    content: "Read the attachment",
  };
  const requestInput = {
    threadId,
    runId: randomUUID(),
    messages: [message],
    tools: [],
    context: [],
    state: {},
  };

  await admitRun({
    threadId,
    runId: requestInput.runId,
    messageId: message.id,
    request: requestInput,
    userMessage: message,
    isResume: false,
  });
  assert.equal(
    (await history()).conversations.find((row) => row.threadId === threadId)
      ?.title,
    "Read the attachment",
  );
});

test("cleanup finds an upload that commits after its timeout and the first deletion pass", async () => {
  const threadId = randomUUID();
  const id = randomUUID();
  const store = await import("../storage/object-store");
  const originalPut = store.putObject;
  let commitRemoteUpload!: () => Promise<void>;
  const timeout = vi
    .spyOn(store, "putObject")
    .mockImplementationOnce((key, data) => {
      // The caller sees a timeout while the accepted remote PUT remains in flight.
      commitRemoteUpload = () => originalPut(key, data);

      return Promise.reject(new Error("Remote PUT response timed out"));
    });

  try {
    const response = await app.request(`/conversations/${threadId}/files`, {
      method: "POST",
      headers: { "X-Filename": "late.txt", "X-File-Id": id },
      body: "late remote commit",
    });

    assert.equal(response.status, 503);
  } finally {
    timeout.mockRestore();
  }

  const { skillFiles } = await import("../db/skill-file-schema");
  const [metadata] = await database.db
    .select()
    .from(skillFiles)
    .where(eq(skillFiles.id, id));
  const { deleteConversation } = await import("./management");
  const { cleanupDeletedSkillFiles } = await import("./skill-file-cleanup");

  await deleteConversation(threadId);
  await cleanupDeletedSkillFiles();
  await commitRemoteUpload();
  const lateObject = await s3.send(
    new ListObjectsV2Command({
      Bucket: "skill-tests",
      Prefix: metadata!.objectKey,
    }),
  );

  assert.equal(lateObject.KeyCount, 1);
  await cleanupDeletedSkillFiles();
  const cleaned = await s3.send(
    new ListObjectsV2Command({
      Bucket: "skill-tests",
      Prefix: metadata!.objectKey,
    }),
  );

  assert.equal(cleaned.KeyCount, 0);
  assert.equal((await upload(threadId)).response.status, 404);
});

test("empty file downloads preserve zero bytes", async () => {
  const threadId = randomUUID();
  const { id, response } = await upload(threadId, "empty.txt", "");

  assert.equal(response.status, 201);
  const download = await app.request(`/conversations/${threadId}/files/${id}`);

  assert.equal(download.status, 200);
  assert.equal((await download.arrayBuffer()).byteLength, 0);
});

test("one denied S3 deletion does not block other objects", async () => {
  const first = await upload(randomUUID(), "denied.txt");
  const second = await upload(randomUUID(), "allowed.txt");
  const { skillFiles } = await import("../db/skill-file-schema");
  const [denied] = await database.db
    .select()
    .from(skillFiles)
    .where(eq(skillFiles.id, first.id));
  const [allowed] = await database.db
    .select()
    .from(skillFiles)
    .where(eq(skillFiles.id, second.id));
  const { deleteConversation } = await import("./management");

  await deleteConversation(denied!.threadId);
  await deleteConversation(allowed!.threadId);
  const store = await import("../storage/object-store");
  const originalDelete = store.deleteObject;
  const interceptor = vi
    .spyOn(store, "deleteObject")
    .mockImplementation(async (key, signal) => {
      if (key === denied!.objectKey) {
        throw new Error("Access denied for one object");
      }

      await originalDelete(key, signal);
    });
  const { cleanupDeletedSkillFiles } = await import("./skill-file-cleanup");

  try {
    await assert.rejects(cleanupDeletedSkillFiles(), /could not be deleted/);
  } finally {
    interceptor.mockRestore();
  }

  const [removed] = await database.db
    .select()
    .from(skillFiles)
    .where(eq(skillFiles.id, allowed!.id));

  assert.ok(removed!.objectDeletedAt);
  const [remaining] = await database.db
    .select()
    .from(skillFiles)
    .where(eq(skillFiles.id, denied!.id));

  assert.ok(remaining!.cleanupAttemptedAt);
  await cleanupDeletedSkillFiles();
});
