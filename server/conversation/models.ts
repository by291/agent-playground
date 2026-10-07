import { and, desc, eq, isNull, or } from "drizzle-orm";
import { db } from "../db/database";
import { conversationRuns, conversations } from "../db/schema";
import { externalTasks } from "../db/external-task-schema";
import { fetchAgentInfo } from "../agent/info";
import { availableModelId } from "../agent/models";
import { isRunActive } from "../../shared/run-status";
import { SubmissionError } from "./errors";
import { notifyConversation } from "./changes";

export async function selectConversationModel(
  threadId: string,
  selection: string,
) {
  const modelId = availableModelId(await fetchAgentInfo(), selection);

  return db.transaction(async (tx) => {
    // Serialize model changes with admission so the next run sees one choice.
    const [conversation] = await tx
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.threadId, threadId),
          isNull(conversations.deletedAt),
        ),
      )
      .for("update");

    if (!conversation) {
      throw new SubmissionError("Conversation not found", 404);
    }

    const [run] = await tx
      .select()
      .from(conversationRuns)
      .where(eq(conversationRuns.threadId, threadId))
      .orderBy(desc(conversationRuns.submitSeq))
      .limit(1);
    const [externalWork] = await tx
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
      )
      .limit(1);
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
