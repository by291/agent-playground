import { MessageSchema } from "@ag-ui/client";
import { langGraphInterruptsToAGUI } from "@ag-ui/langgraph";
import type { ThreadState } from "@langchain/langgraph-sdk";
import { and, desc, eq, inArray } from "drizzle-orm";
import { aegra } from "../agent/client";
import { db } from "../db/database";
import {
  conversationMessages,
  conversationRuns,
  conversations,
  type RunRow,
} from "../db/schema";
import { isRunFinished } from "../../shared/run-status";
import { latestRun } from "./run-store";
import { reconcileRun } from "./recovery";

function completedMessages(state: ThreadState) {
  const values: unknown = state.values;

  if (
    !values ||
    typeof values !== "object" ||
    !("messages" in values) ||
    !Array.isArray(values.messages)
  ) {
    return [];
  }

  return values.messages.flatMap((raw: unknown) => {
    if (
      !raw ||
      typeof raw !== "object" ||
      !("type" in raw) ||
      raw.type !== "ai" ||
      !("content" in raw) ||
      typeof raw.content !== "string" ||
      !raw.content.trim()
    ) {
      return [];
    }

    const parsed = MessageSchema.safeParse({
      id: "id" in raw ? raw.id : undefined,
      role: "assistant",
      content: raw.content,
    });

    return parsed.success ? [parsed.data] : [];
  });
}

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
  const messages = completedMessages(checkpoint.state);

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
        .filter(({ message }) => !savedIds.has(message.id));

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
      .update(conversationRuns)
      .set({ checkpointSynced: true, interrupts: checkpoint.interrupts })
      .where(eq(conversationRuns.aguiRunId, run.aguiRunId));
  });
}

export async function synchronizeConversation(threadId: string): Promise<void> {
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
