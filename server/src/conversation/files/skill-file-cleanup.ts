import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "../../db/database.js";
import { conversations } from "../../db/conversation-schema.js";
import { skillFiles } from "../../db/skill-file-schema.js";
import {
  createObjectReconciler,
  startObjectCleanup,
} from "../../storage/object-cleanup.js";
import { deleteObject } from "../../storage/object-store.js";

const cleanupBatchSize = 50;
const deletedConversation = and(
  eq(conversations.threadId, skillFiles.threadId),
  isNotNull(conversations.deletedAt),
);

async function enqueueDeletedSkillFiles(objectKeys: string[]) {
  await db
    .update(skillFiles)
    .set({ objectDeletedAt: null })
    .where(
      and(
        inArray(skillFiles.objectKey, objectKeys),
        sql`EXISTS (
          SELECT 1
          FROM conversations
          WHERE thread_id = ${skillFiles.threadId} AND deleted_at IS NOT NULL
        )`,
      ),
    );
}

function listCleanupCandidates() {
  const deletedFiles = db
    .select({ id: skillFiles.id })
    .from(skillFiles)
    .innerJoin(conversations, deletedConversation);

  return deletedFiles
    .where(isNull(skillFiles.objectDeletedAt))
    .orderBy(
      sql`${skillFiles.cleanupAttemptedAt} ASC NULLS FIRST`,
      skillFiles.id,
    )
    .limit(cleanupBatchSize);
}

async function removeSkillFile(id: string, signal?: AbortSignal) {
  // Commit each removal separately; one denied object must not block other conversations.
  await db.transaction(async (transaction) => {
    const deletedFiles = transaction
      .select({ file: skillFiles })
      .from(skillFiles)
      .innerJoin(conversations, deletedConversation);
    const [fileToRemove] = await deletedFiles
      .where(and(eq(skillFiles.id, id), isNull(skillFiles.objectDeletedAt)))
      .for("update");

    if (!fileToRemove) {
      return;
    }

    await deleteObject(fileToRemove.file.objectKey, signal);

    // Keep the object key so a remote upload that finishes later can be deleted again.
    await transaction
      .update(skillFiles)
      .set({ objectDeletedAt: new Date(), cleanupAttemptedAt: new Date() })
      .where(eq(skillFiles.id, id));
  });
}

/** Creates a cleanup that reconciles late uploads and retries deleted Skill files in batches. */
export function createSkillFileCleanup() {
  const reconcileObjects = createObjectReconciler(
    "skill-files/",
    enqueueDeletedSkillFiles,
  );

  return async (signal?: AbortSignal) => {
    const failures: unknown[] = [];

    try {
      await reconcileObjects(signal);
    } catch (error) {
      failures.push(error);
    }

    const candidates = await listCleanupCandidates();

    for (const { id } of candidates) {
      if (signal?.aborted) {
        break;
      }

      try {
        await removeSkillFile(id, signal);
      } catch (error) {
        failures.push(error);

        // Move failures behind unattempted candidates while retaining their object intent.
        await db
          .update(skillFiles)
          .set({ cleanupAttemptedAt: new Date() })
          .where(eq(skillFiles.id, id));
      }
    }

    if (failures.length) {
      throw new AggregateError(
        failures,
        "Some Skill files could not be deleted",
      );
    }
  };
}

/** Starts the conversation file cleanup worker with a fresh pagination cursor. */
export function startSkillFileCleanup() {
  return startObjectCleanup(
    createSkillFileCleanup(),
    "Skill file cleanup failed; will retry",
  );
}
