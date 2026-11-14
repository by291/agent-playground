import { and, asc, eq, gt, inArray, isNull, not, or, sql } from "drizzle-orm";
import { db } from "../../db/database.js";
import { externalTasks } from "../../db/external-task-schema.js";
import {
  conversationRuns,
  conversations,
} from "../../db/conversation-schema.js";

const TASK_SCAN_PAGE_SIZE = 100;

type ExternalTask = typeof externalTasks.$inferSelect;
type ContinuationRun = typeof conversationRuns.$inferSelect;

export interface ScannedExternalTask {
  task: ExternalTask;
  continuation: ContinuationRun | null;
}

/** Yields tasks whose continuation is absent or still needs execution/checkpoint recovery. */
export async function* scanExternalTasks(): AsyncGenerator<ScannedExternalTask> {
  let cursor: string | undefined;

  while (true) {
    const taskJoin = db
      .select({ task: externalTasks, continuation: conversationRuns })
      .from(externalTasks)
      .innerJoin(
        conversations,
        eq(externalTasks.threadId, conversations.threadId),
      );
    const continuationJoin = taskJoin.leftJoin(
      conversationRuns,
      eq(externalTasks.continuationRunId, conversationRuns.aguiRunId),
    );

    const needsCheckpointSync = sql`NOT ${conversationRuns.checkpointSynced}`;
    const rows = await continuationJoin
      .where(
        and(
          isNull(conversations.deletedAt),
          or(
            isNull(conversationRuns.aguiRunId),
            needsCheckpointSync,
            not(
              inArray(conversationRuns.status, [
                "completed",
                "failed",
                "interrupted",
              ]),
            ),
          ),
          cursor ? gt(externalTasks.taskId, cursor) : undefined,
        ),
      )
      .orderBy(asc(externalTasks.taskId))
      .limit(TASK_SCAN_PAGE_SIZE);

    const last = rows.at(-1);

    if (!last) {
      return;
    }

    // Keyset paging keeps the scan bounded while callbacks update task rows.
    cursor = last.task.taskId;
    yield* rows;

    if (rows.length < TASK_SCAN_PAGE_SIZE) {
      return;
    }
  }
}
