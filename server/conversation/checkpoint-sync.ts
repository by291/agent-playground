import { langGraphInterruptsToAGUI } from "@ag-ui/langgraph";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { aegra } from "../agent/client";
import { db } from "../db/database";
import {
  conversationMessages,
  conversationRuns,
  conversations,
  type RunRow,
} from "../db/schema";
import { isRunFinished } from "../../shared/run-status";
import { parseContextUsage } from "../../shared/context-usage";
import { latestRun } from "./run-store";
import { reconcileRun } from "./recovery";
import { completedMessages, reasoningMessageSuffix } from "../agent/messages";
import { conversationExists } from "./management";
import { workflowOutputs } from "../db/workflow-schema";
import { workflowReplyMessages } from "../../shared/workflow-output";

async function readCompletedCheckpoint(run: RunRow) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const state = await aegra.threads.getState(run.threadId);
    const interrupts = langGraphInterruptsToAGUI(
      state.tasks.flatMap((task) => task.interrupts),
    );

    if (run.status !== "interrupted" || interrupts.length) {
      return { state, interrupts };
    }

    // The interrupt outcome can arrive just before its checkpoint is committed.
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  throw new Error("Interrupted checkpoint is not ready");
}

async function saveCheckpoint(
  run: RunRow,
  checkpoint: Awaited<ReturnType<typeof readCompletedCheckpoint>>,
) {
  const messages = completedMessages(checkpoint.state.values);
  const outputs = await db
    .select({ payload: workflowOutputs.payload })
    .from(workflowOutputs)
    .where(
      and(
        eq(workflowOutputs.threadId, run.threadId),
        eq(workflowOutputs.aguiRunId, run.aguiRunId),
      ),
    )
    .orderBy(asc(workflowOutputs.outputSeq));

  // Nested workflow replies live in their checkpointed workflow outputs, not
  // the paused parent agent's message state. Archive them before its final reply.
  messages.unshift(
    ...outputs.flatMap((output) => workflowReplyMessages(output.payload)),
  );
  const values: unknown = checkpoint.state.values;
  const usage =
    values && typeof values === "object" && "context_usage" in values
      ? parseContextUsage(values.context_usage)
      : null;

  await db.transaction(async (tx) => {
    // Admission uses the same lock: checkpoint ownership cannot change mid-save.
    await tx
      .select({ id: conversations.threadId })
      .from(conversations)
      .where(eq(conversations.threadId, run.threadId))
      .for("update");

    const [current] = await tx
      .select()
      .from(conversationRuns)
      .where(eq(conversationRuns.threadId, run.threadId))
      .orderBy(desc(conversationRuns.submitSeq))
      .limit(1);

    if (
      current?.aguiRunId !== run.aguiRunId ||
      current.checkpointSynced ||
      current.status !== run.status
    ) {
      return;
    }

    if (messages.length) {
      const saved = await tx
        .select({ id: conversationMessages.messageId })
        .from(conversationMessages)
        .where(
          and(
            eq(conversationMessages.threadId, run.threadId),
            inArray(
              conversationMessages.messageId,
              messages.map((message) => message.id),
            ),
          ),
        );
      const savedIds = new Set(saved.map((message) => message.id));
      const additions = messages
        .map((message, index) => ({ message, order: index + 1 }))
        .filter(({ message }) => {
          if (savedIds.has(message.id)) {
            return false;
          }

          if (message.role === "reasoning") {
            const sourceId = message.id.slice(
              0,
              -reasoningMessageSuffix.length,
            );

            // Older archives lack reasoning. Do not assign an already saved
            // answer's newly extracted reasoning to the current user turn.
            if (savedIds.has(sourceId)) {
              return false;
            }
          }

          return true;
        });

      if (additions.length) {
        await tx
          .insert(conversationMessages)
          .values(
            additions.map(({ message, order }) => ({
              messageId: message.id,
              threadId: run.threadId,
              submitSeq: run.submitSeq,
              messageOrder: order,
              message,
            })),
          )
          .onConflictDoNothing();
      }
    }

    await tx
      .update(conversations)
      .set({ contextUsage: usage })
      .where(eq(conversations.threadId, run.threadId));

    await tx
      .update(conversationRuns)
      .set({ checkpointSynced: true, interrupts: checkpoint.interrupts })
      .where(eq(conversationRuns.aguiRunId, run.aguiRunId));
  });
}

export async function synchronizeConversation(threadId: string): Promise<void> {
  if (!(await conversationExists(threadId))) {
    return;
  }

  const latest = await latestRun(threadId);

  if (!latest || latest.status === "prepared") {
    return;
  }

  const run = await reconcileRun(latest);

  if (!isRunFinished(run.status) || run.checkpointSynced) {
    return;
  }

  await saveCheckpoint(run, await readCompletedCheckpoint(run));
}
