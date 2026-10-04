import { createHash, randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db/database";
import { conversations, conversationRuns } from "../db/schema";
import { skillFiles } from "../db/skill-file-schema";
import { SubmissionError } from "./errors";
import { getObject, putObject } from "../storage/object-store";
import { maxSkillFileBytes, type SkillFile } from "../../shared/skill-files";

interface FileInput {
  id: string;
  threadId: string;
  name: string;
  data: Buffer;
  runId?: string;
}

export async function storeSkillFile(input: FileInput): Promise<SkillFile> {
  if (input.data.length > maxSkillFileBytes) {
    throw new SubmissionError("File exceeds 10 MiB", 400);
  }

  const sha256 = createHash("sha256").update(input.data).digest("hex");

  // Commit an object intent first so failed uploads remain recoverable by retry or deletion.
  await db.transaction(async (tx) => {
    if (!input.runId) {
      await tx
        .insert(conversations)
        .values({ threadId: input.threadId })
        .onConflictDoNothing();
    }

    const [conversation] = await tx
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.threadId, input.threadId),
          isNull(conversations.deletedAt),
        ),
      )
      .for("update");

    if (!conversation) {
      throw new SubmissionError("Conversation not found", 404);
    }

    if (input.runId) {
      const [run] = await tx
        .select({ id: conversationRuns.aguiRunId })
        .from(conversationRuns)
        .where(
          and(
            eq(conversationRuns.aguiRunId, input.runId),
            eq(conversationRuns.threadId, input.threadId),
          ),
        );

      if (!run) {
        throw new SubmissionError(
          "File needs an existing conversation run",
          409,
        );
      }
    }

    const [existing] = await tx
      .select()
      .from(skillFiles)
      .where(eq(skillFiles.id, input.id));

    if (existing) {
      if (
        existing.threadId !== input.threadId ||
        existing.name !== input.name ||
        existing.runId !== (input.runId ?? null) ||
        existing.sha256 !== sha256 ||
        existing.size !== input.data.length
      ) {
        throw new SubmissionError("Conflicting file identity or content", 409);
      }
    } else {
      const [usage] = await tx
        .select({
          size: sql<number>`coalesce(sum(${skillFiles.size}), 0)::integer`,
        })
        .from(skillFiles)
        .where(eq(skillFiles.threadId, input.threadId));

      if ((usage?.size ?? 0) + input.data.length > 100 * 1024 * 1024) {
        throw new SubmissionError("Conversation files exceed 100 MiB", 409);
      }

      await tx.insert(skillFiles).values({
        id: input.id,
        threadId: input.threadId,
        runId: input.runId,
        name: input.name,
        size: input.data.length,
        sha256,
        objectKey: `skill-files/${randomUUID()}`,
      });
    }
  });

  return db.transaction(async (tx) => {
    // Serialize publication with deletion and duplicate uploads to this conversation.
    const [conversation] = await tx
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.threadId, input.threadId),
          isNull(conversations.deletedAt),
        ),
      )
      .for("update");
    const [file] = await tx
      .select()
      .from(skillFiles)
      .where(eq(skillFiles.id, input.id));

    if (!conversation || !file) {
      throw new SubmissionError("Conversation or file no longer exists", 404);
    }

    if (!file.ready) {
      await putObject(file.objectKey, input.data);
      await tx
        .update(skillFiles)
        .set({ ready: true })
        .where(eq(skillFiles.id, input.id));
    }

    return {
      id: input.id,
      threadId: input.threadId,
      name: input.name,
      size: input.data.length,
    };
  });
}

export async function readSkillFile(threadId: string, id: string) {
  const [row] = await db
    .select({ file: skillFiles })
    .from(skillFiles)
    .innerJoin(
      conversations,
      and(
        eq(conversations.threadId, skillFiles.threadId),
        isNull(conversations.deletedAt),
      ),
    )
    .where(
      and(
        eq(skillFiles.threadId, threadId),
        eq(skillFiles.id, id),
        eq(skillFiles.ready, true),
      ),
    );

  if (!row) {
    throw new SubmissionError("File not found", 404);
  }

  const data = await getObject(row.file.objectKey, row.file.size);
  const sha256 = createHash("sha256").update(data).digest("hex");

  if (data.length !== row.file.size || sha256 !== row.file.sha256) {
    throw new Error("Stored file content does not match metadata");
  }

  return { ...row.file, data };
}
