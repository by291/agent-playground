import { and, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db } from "../db/database.js";
import { knowledgeChunks, knowledgeDocuments } from "../db/knowledge-schema.js";
import { logger } from "../observability/logger.js";
import { deleteObject, listObjects } from "../storage/object-store.js";

let continuationToken: string | undefined;

export async function cleanupDeletedDocuments(signal?: AbortSignal) {
  const failures: unknown[] = [];

  try {
    // A remote PUT may commit after its caller times out and cleanup finishes.
    // Reconcile one page per tick so that late objects return to the deletion queue.
    const page = await listObjects("knowledge/", continuationToken, signal);

    continuationToken = page.continuationToken;

    if (page.keys.length) {
      await db
        .update(knowledgeDocuments)
        .set({ objectDeletedAt: null })
        .where(
          and(
            isNotNull(knowledgeDocuments.deletedAt),
            inArray(knowledgeDocuments.objectKey, page.keys),
          ),
        );
    }
  } catch (error) {
    continuationToken = undefined;
    failures.push(error);
  }

  const candidates = await db
    .select({ id: knowledgeDocuments.id })
    .from(knowledgeDocuments)
    .where(
      and(
        isNotNull(knowledgeDocuments.deletedAt),
        or(
          isNull(knowledgeDocuments.objectDeletedAt),
          sql`EXISTS (SELECT 1 FROM knowledge_chunks WHERE document_id = ${knowledgeDocuments.id})`,
        ),
      ),
    )
    .orderBy(
      sql`${knowledgeDocuments.cleanupAttemptedAt} ASC NULLS FIRST`,
      knowledgeDocuments.id,
    )
    .limit(50);

  for (const candidate of candidates) {
    if (signal?.aborted) {
      break;
    }

    try {
      // Commit each removal separately; one denied object must not block other documents.
      await db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(knowledgeDocuments)
          .where(
            and(
              eq(knowledgeDocuments.id, candidate.id),
              isNotNull(knowledgeDocuments.deletedAt),
            ),
          )
          .for("update");

        if (!row) {
          return;
        }

        if (!row.objectDeletedAt) {
          await deleteObject(row.objectKey, signal);
        }

        await tx
          .delete(knowledgeChunks)
          .where(eq(knowledgeChunks.documentId, row.id));
        // Keep the tombstone so a delayed retry cannot recreate the same document ID.
        await tx
          .update(knowledgeDocuments)
          .set({ objectDeletedAt: new Date(), cleanupAttemptedAt: new Date() })
          .where(eq(knowledgeDocuments.id, row.id));
      });
    } catch (error) {
      failures.push(error);
      await db
        .update(knowledgeDocuments)
        .set({ cleanupAttemptedAt: new Date() })
        .where(eq(knowledgeDocuments.id, candidate.id));
    }
  }

  if (failures.length) {
    throw new AggregateError(
      failures,
      "Some Knowledge documents could not be deleted",
    );
  }
}

export function startKnowledgeCleanup() {
  const controller = new AbortController();
  let stopped = false;
  let active: Promise<void> | undefined;

  function tick() {
    if (stopped || active) {
      return;
    }

    active = cleanupDeletedDocuments(controller.signal)
      .catch((error: unknown) => {
        if (!stopped) {
          logger.error(
            { err: error },
            "Knowledge document cleanup failed; will retry",
          );
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
