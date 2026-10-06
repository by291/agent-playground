import { filenameSchema } from "../../shared/files";
import { createHash } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  maxKnowledgeBytes,
  knowledgeTextEncodingSchema,
  type KnowledgeDocument,
  type KnowledgeTextEncoding,
} from "../../shared/knowledge";
import { db } from "../db/database";
import { knowledgeChunks, knowledgeDocuments } from "../db/knowledge-schema";
import { getObject, putObject } from "../storage/object-store";

export class KnowledgeError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409,
  ) {
    super(message);
  }
}

const liveDocument = (id: string) =>
  and(eq(knowledgeDocuments.id, id), isNull(knowledgeDocuments.deletedAt));
const filename = filenameSchema.refine((name) => /\.(txt|md|pdf)$/i.test(name));

function publicDocument(
  row: typeof knowledgeDocuments.$inferSelect,
): KnowledgeDocument {
  return {
    id: row.id,
    name: row.name,
    size: row.size,
    status: knowledgeDocumentStatus(row.status),
    error: row.error,
    textEncoding: knowledgeTextEncodingSchema
      .nullable()
      .parse(row.textEncoding),
    chunkCount: row.chunkCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function knowledgeDocumentStatus(status: string): KnowledgeDocument["status"] {
  return z
    .enum(["uploading", "queued", "indexing", "ready", "failed"])
    .parse(status);
}

export async function listDocuments() {
  const rows = await db
    .select()
    .from(knowledgeDocuments)
    .where(isNull(knowledgeDocuments.deletedAt))
    .orderBy(desc(knowledgeDocuments.createdAt));

  return rows.map(publicDocument);
}

export function parseTextEncoding(value: string | undefined) {
  if (value === undefined) {
    return undefined;
  }

  if (value === "auto") {
    return null;
  }

  const result = knowledgeTextEncodingSchema.safeParse(value);

  if (!result.success) {
    throw new KnowledgeError("Unsupported text encoding", 400);
  }

  return result.data;
}

function validateTextEncoding(
  name: string,
  encoding: KnowledgeTextEncoding | null,
) {
  if (encoding !== null && !/\.(txt|md)$/i.test(name)) {
    throw new KnowledgeError(
      "Text encoding applies only to TXT and Markdown files",
      400,
    );
  }
}

export async function uploadDocument(
  id: string,
  name: string,
  data: Buffer,
  textEncoding?: KnowledgeTextEncoding | null,
) {
  if (
    !z.string().uuid().safeParse(id).success ||
    !filename.safeParse(name).success ||
    !data.length ||
    data.length > maxKnowledgeBytes
  ) {
    throw new KnowledgeError(
      "Use a nonempty TXT, Markdown or PDF file up to 10 MiB",
      400,
    );
  }

  validateTextEncoding(name, textEncoding ?? null);
  const sha256 = createHash("sha256").update(data).digest("hex");

  // Persist the upload intent first so a crash cannot leave an untracked object.
  await db
    .insert(knowledgeDocuments)
    .values({
      id,
      name,
      size: data.length,
      sha256,
      textEncoding: textEncoding ?? null,
      objectKey: `knowledge/${id}`,
    })
    .onConflictDoNothing();

  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(knowledgeDocuments)
      .where(eq(knowledgeDocuments.id, id))
      .for("update");

    if (!row || row.deletedAt) {
      throw new KnowledgeError("Document was deleted", 404);
    }

    if (
      row.sha256 !== sha256 ||
      row.name !== name ||
      row.size !== data.length ||
      (textEncoding !== undefined && row.textEncoding !== textEncoding)
    ) {
      throw new KnowledgeError(
        "Document identity is already used by another file",
        409,
      );
    }

    if (row.status !== "uploading") {
      return publicDocument(row);
    }

    // The document lock also serializes deletion and object cleanup with this PUT.
    await putObject(row.objectKey, data);
    const [queued] = await tx
      .update(knowledgeDocuments)
      .set({ status: "queued", updatedAt: new Date() })
      .where(eq(knowledgeDocuments.id, id))
      .returning();

    return publicDocument(queued!);
  });
}

export async function readDocument(id: string) {
  const [row] = await db
    .select()
    .from(knowledgeDocuments)
    .where(liveDocument(id));

  if (!row || row.status === "uploading") {
    throw new KnowledgeError("Document is unavailable", 404);
  }

  const data = await getObject(row.objectKey, row.size);

  if (
    data.length !== row.size ||
    createHash("sha256").update(data).digest("hex") !== row.sha256
  ) {
    throw new Error("Stored document does not match its metadata");
  }

  // A concurrent delete must not turn this read into a fresh download link.
  const [current] = await db
    .select({ id: knowledgeDocuments.id })
    .from(knowledgeDocuments)
    .where(liveDocument(id));

  if (!current) {
    throw new KnowledgeError("Document was deleted", 404);
  }

  return { name: row.name, data };
}

export async function changeDocument(
  id: string,
  action: "reindex" | "delete",
  textEncoding?: KnowledgeTextEncoding | null,
) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(knowledgeDocuments)
      .where(liveDocument(id))
      .for("update");

    if (!row) {
      throw new KnowledgeError("Document is unavailable", 404);
    }

    if (
      action === "reindex" &&
      (row.status === "uploading" ||
        row.status === "indexing" ||
        row.status === "queued")
    ) {
      throw new KnowledgeError(
        "Wait for the current upload or indexing attempt",
        409,
      );
    }

    if (textEncoding !== undefined) {
      validateTextEncoding(row.name, textEncoding);
    }

    await tx
      .update(knowledgeChunks)
      .set({ visible: false })
      .where(eq(knowledgeChunks.documentId, id));
    const [updated] = await tx
      .update(knowledgeDocuments)
      .set({
        ...(action === "delete"
          ? { deletedAt: new Date() }
          : { status: "queued" }),
        generation: null,
        leaseUntil: null,
        chunkCount: 0,
        error: null,
        ...(textEncoding === undefined ? {} : { textEncoding }),
        updatedAt: new Date(),
      })
      .where(eq(knowledgeDocuments.id, id))
      .returning();

    return publicDocument(updated!);
  });
}
