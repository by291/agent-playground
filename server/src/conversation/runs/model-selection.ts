import { and, desc, eq, isNull, or } from "drizzle-orm";
import { db } from "../../db/database.js";
import {
  conversationRuns,
  conversations,
} from "../../db/conversation-schema.js";
import { externalTasks } from "../../db/external-task-schema.js";
import { fetchAgentInfo } from "../../agent/agent-info.js";
import { availableModelId } from "./model-validation.js";
import { isRunActive } from "../../../../shared/run-status.js";
import { SubmissionError } from "../errors.js";
import { notifyConversation } from "../events/publish.js";

/** Pin the next model choice while holding the conversation admission lock. */
export async function selectConversationModel(
  threadId: string,
  selection: string,
) {
  const modelId = availableModelId(await fetchAgentInfo(), selection);

  return db.transaction(async (tx) => {
    // Serialize model changes with admission so the next run sees one choice.
    const conversationLockQuery = tx
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.threadId, threadId),
          isNull(conversations.deletedAt),
        ),
      );

    const [conversation] = await conversationLockQuery.for("update");

    if (!conversation) {
      throw new SubmissionError("Conversation not found", 404);
    }

    const latestRunQuery = tx
      .select()
      .from(conversationRuns)
      .where(eq(conversationRuns.threadId, threadId));

    const [run] = await latestRunQuery
      .orderBy(desc(conversationRuns.submitSeq))
      .limit(1);

    const externalWorkQuery = tx
      .select({ taskId: externalTasks.taskId })
      .from(externalTasks)
      .where(
        and(
          eq(externalTasks.threadId, threadId),
          or(
            isNull(externalTasks.continuationRunId),
            eq(externalTasks.status, "queued"),
            eq(externalTasks.status, "running"),
            eq(externalTasks.status, "input_required"),
          ),
        ),
      );

    const [externalWork] = await externalWorkQuery.limit(1);

    const unfinishedRun =
      run &&
      (isRunActive(run.status) ||
        run.status === "submission_unknown" ||
        run.status === "interrupted");

    if (unfinishedRun || externalWork) {
      throw new SubmissionError(
        "Wait for conversation work to finish before changing its model",
        409,
      );
    }

    await tx
      .update(conversations)
      .set({ modelId })
      .where(eq(conversations.threadId, threadId));

    // PostgreSQL delivers transactional notifications only after commit.
    await notifyConversation(tx, threadId);

    return { threadId, modelId };
  });
}
