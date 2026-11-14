import { and, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db } from "../db/database.js";
import { knowledgeChunks, knowledgeDocuments } from "../db/knowledge-schema.js";
import {
  createObjectReconciler,
  startObjectCleanup,
} from "../storage/object-cleanup.js";
import { deleteObject } from "../storage/object-store.js";

const cleanupBatchSize = 50;

async function enqueueDeletedDocuments(objectKeys: string[]) {
  await db
    .update(knowledgeDocuments)
    .set({ objectDeletedAt: null })
    .where(
      and(
        isNotNull(knowledgeDocuments.deletedAt),
        inArray(knowledgeDocuments.objectKey, objectKeys),
      ),
    );
}

function listCleanupCandidates() {
  const deletedDocuments = db
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
    );

  return deletedDocuments
    .orderBy(
      sql`${knowledgeDocuments.cleanupAttemptedAt} ASC NULLS FIRST`,
      knowledgeDocuments.id,
    )
    .limit(cleanupBatchSize);
}

async function removeDocument(id: string, signal?: AbortSignal) {
  // Commit each removal separately; one denied object must not block other documents.
  await db.transaction(async (transaction) => {
    const deletedDocument = transaction
      .select()
      .from(knowledgeDocuments)
      .where(
        and(
          eq(knowledgeDocuments.id, id),
          isNotNull(knowledgeDocuments.deletedAt),
        ),
      );
    const [document] = await deletedDocument.for("update");

    if (!document) {
      return;
    }

    if (!document.objectDeletedAt) {
      await deleteObject(document.objectKey, signal);
    }

    await transaction
      .delete(knowledgeChunks)
      .where(eq(knowledgeChunks.documentId, id));

    // Keep the tombstone so a delayed retry cannot recreate the same document ID.
    await transaction
      .update(knowledgeDocuments)
      .set({ objectDeletedAt: new Date(), cleanupAttemptedAt: new Date() })
      .where(eq(knowledgeDocuments.id, id));
  });
}

/** Creates a cleanup that reconciles late uploads and retries deleted documents in batches. */
export function createKnowledgeCleanup() {
  const reconcileObjects = createObjectReconciler(
    "knowledge/",
    enqueueDeletedDocuments,
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
        await removeDocument(id, signal);
      } catch (error) {
        failures.push(error);

        // Move failures behind unattempted candidates while retaining their tombstones.
        await db
          .update(knowledgeDocuments)
          .set({ cleanupAttemptedAt: new Date() })
          .where(eq(knowledgeDocuments.id, id));
      }
    }

    if (failures.length) {
      throw new AggregateError(
        failures,
        "Some Knowledge documents could not be deleted",
      );
    }
  };
}

/** Starts the Knowledge document cleanup worker with a fresh pagination cursor. */
export function startKnowledgeCleanup() {
  return startObjectCleanup(
    createKnowledgeCleanup(),
    "Knowledge document cleanup failed; will retry",
  );
}
