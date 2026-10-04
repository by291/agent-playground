import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "../db/database";
import { conversations } from "../db/schema";
import { skillFiles } from "../db/skill-file-schema";
import { logger } from "../observability/logger";
import { deleteObject } from "../storage/object-store";

export async function cleanupDeletedSkillFiles(signal?: AbortSignal) {
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
    .orderBy(
      sql`${skillFiles.cleanupAttemptedAt} ASC NULLS FIRST`,
      skillFiles.id,
    )
    .limit(50);
  const failures: unknown[] = [];

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
          .where(eq(skillFiles.id, candidate.id))
          .for("update");

        if (!row) {
          return;
        }

        await deleteObject(row.file.objectKey, signal);
        await tx.delete(skillFiles).where(eq(skillFiles.id, row.file.id));
      });
    } catch (error) {
      failures.push(error);
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
