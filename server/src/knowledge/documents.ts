import { createHash } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { filenameSchema } from "../../../shared/files.js";
import {
  knowledgeDocumentSchema,
  knowledgeTextEncodingSchema,
  maxKnowledgeBytes,
  type KnowledgeDocument,
  type KnowledgeTextEncoding,
} from "../../../shared/knowledge.js";
import { db } from "../db/database.js";
import { knowledgeChunks, knowledgeDocuments } from "../db/knowledge-schema.js";
import { getObject, putObject } from "../storage/object-store.js";

const documentIdSchema = z.string().uuid();
const documentFilename = filenameSchema.refine((name) =>
  /\.(txt|md|pdf)$/i.test(name),
);
const optionalTextEncoding = knowledgeTextEncodingSchema.nullable();

interface DocumentUpload {
  id: string;
  name: string;
  bytes: Buffer;
  textEncoding?: KnowledgeTextEncoding | null | undefined;
}

/** Carries an expected document operation failure to the HTTP boundary. */
export class KnowledgeError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409,
  ) {
    super(message);
  }
}

function liveDocument(id: string) {
  return and(
    eq(knowledgeDocuments.id, id),
    isNull(knowledgeDocuments.deletedAt),
  );
}

function publicDocument(
  row: typeof knowledgeDocuments.$inferSelect,
): KnowledgeDocument {
  return {
    id: row.id,
    name: row.name,
    size: row.size,
    status: knowledgeDocumentSchema.shape.status.parse(row.status),
    error: row.error,
    textEncoding: optionalTextEncoding.parse(row.textEncoding),
    chunkCount: row.chunkCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
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

/** Lists available document metadata in reverse creation order. */
export async function listDocuments() {
  const liveDocuments = db
    .select()
    .from(knowledgeDocuments)
    .where(isNull(knowledgeDocuments.deletedAt));
  const rows = await liveDocuments.orderBy(desc(knowledgeDocuments.createdAt));

  return rows.map(publicDocument);
}

/** Interprets an omitted encoding as unchanged and automatic detection as null. */
export function parseTextEncoding(value: string | undefined) {
  if (value === undefined) {
    return undefined;
  }

  if (value === "auto") {
    return null;
  }

  const encoding = knowledgeTextEncodingSchema.safeParse(value);

  if (!encoding.success) {
    throw new KnowledgeError("Unsupported text encoding", 400);
  }

  return encoding.data;
}

/** Reserves a document identity and publishes its bytes for indexing, allowing matching retries. */
export async function uploadDocument({
  id,
  name,
  bytes,
  textEncoding,
}: DocumentUpload) {
  const isValidMetadata =
    documentIdSchema.safeParse(id).success &&
    documentFilename.safeParse(name).success;
  const isValidSize = bytes.length > 0 && bytes.length <= maxKnowledgeBytes;

  if (!isValidMetadata || !isValidSize) {
    throw new KnowledgeError(
      "Use a nonempty TXT, Markdown or PDF file up to 10 MiB",
      400,
    );
  }

  validateTextEncoding(name, textEncoding ?? null);

  const sha256 = createHash("sha256").update(bytes).digest("hex");

  // Persist the upload intent first so a crash cannot leave an untracked object.
  await db
    .insert(knowledgeDocuments)
    .values({
      id,
      name,
      size: bytes.length,
      sha256,
      textEncoding: textEncoding ?? null,
      objectKey: `knowledge/${id}`,
    })
    .onConflictDoNothing();

  return db.transaction(async (transaction) => {
    const matchingDocument = transaction
      .select()
      .from(knowledgeDocuments)
      .where(eq(knowledgeDocuments.id, id));
    const [document] = await matchingDocument.for("update");

    if (!document || document.deletedAt) {
      throw new KnowledgeError("Document was deleted", 404);
    }

    const hasIdentityConflict =
      document.sha256 !== sha256 ||
      document.name !== name ||
      document.size !== bytes.length ||
      (textEncoding !== undefined && document.textEncoding !== textEncoding);

    if (hasIdentityConflict) {
      throw new KnowledgeError(
        "Document identity is already used by another file",
        409,
      );
    }

    if (document.status !== "uploading") {
      return publicDocument(document);
    }

    // The document lock also serializes deletion and object cleanup with this PUT.
    await putObject(document.objectKey, bytes);

    const queueDocument = transaction
      .update(knowledgeDocuments)
      .set({ status: "queued", updatedAt: new Date() })
      .where(eq(knowledgeDocuments.id, id));
    const [queuedDocument] = await queueDocument.returning();

    if (!queuedDocument) {
      throw new Error("Locked document disappeared before queuing");
    }

    return publicDocument(queuedDocument);
  });
}

/** Reads and verifies published document bytes while checking for concurrent deletion. */
export async function readDocument(id: string) {
  const [document] = await db
    .select()
    .from(knowledgeDocuments)
    .where(liveDocument(id));

  if (!document || document.status === "uploading") {
    throw new KnowledgeError("Document is unavailable", 404);
  }

  const bytes = await getObject(document.objectKey, document.size);
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  if (bytes.length !== document.size || sha256 !== document.sha256) {
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

  return { name: document.name, bytes };
}

/** Revokes the current indexing generation when requeuing or deleting a document. */
export async function changeDocument(
  id: string,
  action: "reindex" | "delete",
  textEncoding?: KnowledgeTextEncoding | null,
) {
  return db.transaction(async (transaction) => {
    const matchingDocument = transaction
      .select()
      .from(knowledgeDocuments)
      .where(liveDocument(id));
    const [document] = await matchingDocument.for("update");

    if (!document) {
      throw new KnowledgeError("Document is unavailable", 404);
    }

    const isBusy =
      document.status === "uploading" ||
      document.status === "indexing" ||
      document.status === "queued";

    if (action === "reindex" && isBusy) {
      throw new KnowledgeError(
        "Wait for the current upload or indexing attempt",
        409,
      );
    }

    if (textEncoding !== undefined) {
      validateTextEncoding(document.name, textEncoding);
    }

    // Hide old chunks and revoke the generation together; an in-flight worker cannot publish it.
    await transaction
      .update(knowledgeChunks)
      .set({ visible: false })
      .where(eq(knowledgeChunks.documentId, id));

    const newStatus =
      action === "delete" ? { deletedAt: new Date() } : { status: "queued" };
    const updateDocument = transaction
      .update(knowledgeDocuments)
      .set({
        ...newStatus,
        generation: null,
        leaseUntil: null,
        chunkCount: 0,
        error: null,
        ...(textEncoding === undefined ? {} : { textEncoding }),
        updatedAt: new Date(),
      })
      .where(eq(knowledgeDocuments.id, id));
    const [updatedDocument] = await updateDocument.returning();

    if (!updatedDocument) {
      throw new Error("Locked document disappeared before updating");
    }

    return publicDocument(updatedDocument);
  });
}
