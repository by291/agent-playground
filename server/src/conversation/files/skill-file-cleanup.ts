import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "../../db/database.js";
import { conversations } from "../../db/conversation-schema.js";
import { skillFiles } from "../../db/skill-file-schema.js";
import { logger } from "../../observability/logger.js";
import { deleteObject, listObjects } from "../../storage/object-store.js";

let continuationToken: string | undefined;

export async function cleanupDeletedSkillFiles(signal?: AbortSignal) {
  const failures: unknown[] = [];

  try {
    // A timed-out PUT may commit after deletion. Retained intents make it discoverable.
    const page = await listObjects("skill-files/", continuationToken, signal);

    continuationToken = page.continuationToken;

    if (page.keys.length) {
      await db
        .update(skillFiles)
        .set({ objectDeletedAt: null })
        .where(
          and(
            inArray(skillFiles.objectKey, page.keys),
            sql`EXISTS (SELECT 1 FROM conversations WHERE thread_id = ${skillFiles.threadId} AND deleted_at IS NOT NULL)`,
          ),
        );
    }
  } catch (error) {
    continuationToken = undefined;
    failures.push(error);
  }

  const candidates = await db
    .select({ id: skillFiles.id })
    .from(skillFiles)
    .innerJoin(
      conversations,
      and(
        eq(conversations.threadId, skillFiles.threadId),
        isNotNull(conversations.deletedAt),
      ),
    )
    .where(isNull(skillFiles.objectDeletedAt))
    .orderBy(
      sql`${skillFiles.cleanupAttemptedAt} ASC NULLS FIRST`,
      skillFiles.id,
    )
    .limit(50);

  for (const candidate of candidates) {
    if (signal?.aborted) {
      break;
    }

    try {
      // Commit each removal separately; one denied object must not block other conversations.
      await db.transaction(async (tx) => {
        const [row] = await tx
          .select({ file: skillFiles })
          .from(skillFiles)
          .innerJoin(
            conversations,
            and(
              eq(conversations.threadId, skillFiles.threadId),
              isNotNull(conversations.deletedAt),
            ),
          )
          .where(
            and(
              eq(skillFiles.id, candidate.id),
              isNull(skillFiles.objectDeletedAt),
            ),
          )
          .for("update");

        if (!row) {
          return;
        }

        await deleteObject(row.file.objectKey, signal);

        // Keep the object key so a remote upload that finishes later can be deleted again.
        await tx
          .update(skillFiles)
          .set({ objectDeletedAt: new Date(), cleanupAttemptedAt: new Date() })
          .where(eq(skillFiles.id, row.file.id));
      });
    } catch (error) {
      failures.push(error);

      // Move failures behind unattempted candidates while retaining their object intent.
      await db
        .update(skillFiles)
        .set({ cleanupAttemptedAt: new Date() })
        .where(eq(skillFiles.id, candidate.id));
    }
  }

  if (failures.length) {
    throw new AggregateError(failures, "Some Skill files could not be deleted");
  }
}

export function startSkillFileCleanup() {
  const controller = new AbortController();
  let stopped = false;
  let active: Promise<void> | undefined;

  function tick() {
    if (stopped || active) {
      return;
    }

    active = cleanupDeletedSkillFiles(controller.signal)
      .catch((error: unknown) => {
        if (!stopped) {
          logger.error({ err: error }, "Skill file cleanup failed; will retry");
        }
      })
      .finally(() => {
        active = undefined;
      });
  }

  const timer = setInterval(tick, 30_000);

  timer.unref();
  tick();

  return async () => {
    stopped = true;
    clearInterval(timer);
    controller.abort();

    await active;
  };
}
