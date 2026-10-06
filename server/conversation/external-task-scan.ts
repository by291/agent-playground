import { and, asc, eq, gt, inArray, isNull, ne, not, or } from "drizzle-orm";
import { db } from "../db/database";
import { externalTasks } from "../db/external-task-schema";
import { conversationRuns, conversations } from "../db/schema";

export async function* scanExternalTasks() {
  let cursor: string | undefined;

  while (true) {
    const rows = await db
      .select({ task: externalTasks, continuation: conversationRuns })
      .from(externalTasks)
      .innerJoin(
        conversations,
        eq(externalTasks.threadId, conversations.threadId),
      )
      .leftJoin(
        conversationRuns,
        eq(externalTasks.continuationRunId, conversationRuns.aguiRunId),
      )
      .where(
        and(
          isNull(conversations.deletedAt),
          or(
            isNull(conversationRuns.aguiRunId),
            ne(conversationRuns.checkpointSynced, true),
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
      .limit(100);

    if (!rows.length) {
      return;
    }

    cursor = rows.at(-1)!.task.taskId;
    yield* rows;

    if (rows.length < 100) {
      return;
    }
  }
}
