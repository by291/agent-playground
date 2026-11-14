import { createHash, randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  maxSkillFileBytes,
  type SkillFile,
} from "../../../../shared/skill-files.js";
import { db } from "../../db/database.js";
import {
  conversations,
  conversationRuns,
} from "../../db/conversation-schema.js";
import { skillFiles } from "../../db/skill-file-schema.js";
import { getObject, putObject } from "../../storage/object-store.js";
import { SubmissionError } from "../errors.js";

const maxConversationFileBytes = 100 * 1024 * 1024;
const liveConversation = isNull(conversations.deletedAt);

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

interface FileUpload {
  id: string;
  threadId: string;
  name: string;
  bytes: Buffer;
  runId?: string;
}

async function lockConversation(transaction: Transaction, threadId: string) {
  const openConversation = transaction
    .select()
    .from(conversations)
    .where(and(eq(conversations.threadId, threadId), liveConversation));
  const [conversation] = await openConversation.for("update");

  return conversation;
}

async function verifyFileRun(transaction: Transaction, upload: FileUpload) {
  if (!upload.runId) {
    return;
  }

  const [run] = await transaction
    .select({ id: conversationRuns.aguiRunId })
    .from(conversationRuns)
    .where(
      and(
        eq(conversationRuns.aguiRunId, upload.runId),
        eq(conversationRuns.threadId, upload.threadId),
      ),
    );

  if (!run) {
    throw new SubmissionError("File needs an existing conversation run", 409);
  }
}

async function reserveFile(
  transaction: Transaction,
  upload: FileUpload,
  sha256: string,
) {
  if (!upload.runId) {
    await transaction
      .insert(conversations)
      .values({ threadId: upload.threadId })
      .onConflictDoNothing();
  }

  const conversation = await lockConversation(transaction, upload.threadId);

  if (!conversation) {
    throw new SubmissionError("Conversation not found", 404);
  }

  await verifyFileRun(transaction, upload);

  const [existing] = await transaction
    .select()
    .from(skillFiles)
    .where(eq(skillFiles.id, upload.id));

  if (existing) {
    // A matching retry reuses the reserved object key rather than overwriting another file.
    const hasIdentityConflict =
      existing.threadId !== upload.threadId ||
      existing.name !== upload.name ||
      existing.runId !== (upload.runId ?? null) ||
      existing.sha256 !== sha256 ||
      existing.size !== upload.bytes.length;

    if (hasIdentityConflict) {
      throw new SubmissionError("Conflicting file identity or content", 409);
    }

    return;
  }

  const [usage] = await transaction
    .select({
      size: sql<number>`coalesce(sum(${skillFiles.size}), 0)::integer`,
    })
    .from(skillFiles)
    .where(eq(skillFiles.threadId, upload.threadId));
  const requiredBytes = (usage?.size ?? 0) + upload.bytes.length;

  if (requiredBytes > maxConversationFileBytes) {
    throw new SubmissionError("Conversation files exceed 100 MiB", 409);
  }

  await transaction.insert(skillFiles).values({
    id: upload.id,
    threadId: upload.threadId,
    runId: upload.runId,
    name: upload.name,
    size: upload.bytes.length,
    sha256,
    objectKey: `skill-files/${randomUUID()}`,
  });
}

/** Stores a conversation file, reusing the reserved object key on a matching retry. */
export async function storeSkillFile(upload: FileUpload): Promise<SkillFile> {
  if (upload.bytes.length > maxSkillFileBytes) {
    throw new SubmissionError("File exceeds 10 MiB", 400);
  }

  const sha256 = createHash("sha256").update(upload.bytes).digest("hex");

  // Commit an object intent first so failed uploads remain recoverable by retry or deletion.
  await db.transaction((transaction) =>
    reserveFile(transaction, upload, sha256),
  );

  return db.transaction(async (transaction) => {
    // Serialize publication with deletion and duplicate uploads to this conversation.
    const conversation = await lockConversation(transaction, upload.threadId);
    const [file] = await transaction
      .select()
      .from(skillFiles)
      .where(eq(skillFiles.id, upload.id));

    if (!conversation || !file) {
      throw new SubmissionError("Conversation or file no longer exists", 404);
    }

    if (!file.ready) {
      await putObject(file.objectKey, upload.bytes);

      // Publish only after the object is available; a failed write retains the intent.
      await transaction
        .update(skillFiles)
        .set({ ready: true })
        .where(eq(skillFiles.id, upload.id));
    }

    return {
      id: upload.id,
      threadId: upload.threadId,
      name: upload.name,
      size: upload.bytes.length,
    };
  });
}

/** Reads a published file owned by a live conversation and verifies its bytes. */
export async function readSkillFile(threadId: string, id: string) {
  const liveFiles = db
    .select({ file: skillFiles })
    .from(skillFiles)
    .innerJoin(
      conversations,
      and(eq(conversations.threadId, skillFiles.threadId), liveConversation),
    );
  const [record] = await liveFiles.where(
    and(
      eq(skillFiles.threadId, threadId),
      eq(skillFiles.id, id),
      skillFiles.ready,
    ),
  );

  if (!record) {
    throw new SubmissionError("File not found", 404);
  }

  const bytes = await getObject(record.file.objectKey, record.file.size);
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  if (bytes.length !== record.file.size || sha256 !== record.file.sha256) {
    throw new Error("Stored file content does not match metadata");
  }

  return { ...record.file, bytes };
}
