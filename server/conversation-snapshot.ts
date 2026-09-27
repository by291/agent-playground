import type { ThreadState } from "@langchain/langgraph-sdk";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "./database";
import { interruptsFromState, readThreadState, reconcileRun } from "./recovery";
import {
  conversationMessages,
  conversationRuns,
  conversations,
} from "./schema";
import { workflowOutputs } from "./workflow-schema";

async function saveCompletedMessages(threadId: string, state: ThreadState) {
  const values = state.values;
  if (typeof values !== "object" || values === null || Array.isArray(values)) {
    return;
  }

  const messages = values.messages;
  if (!Array.isArray(messages)) return;

  const [latestRun] = await db
    .select({ submitSeq: conversationRuns.submitSeq })
    .from(conversationRuns)
    .where(eq(conversationRuns.threadId, threadId))
    .orderBy(desc(conversationRuns.submitSeq))
    .limit(1);
  if (!latestRun) return;

  for (const raw of messages) {
    if (typeof raw !== "object" || raw === null) continue;
    const message = raw as Record<string, unknown>;
    if (message.type !== "ai" || typeof message.id !== "string") continue;
    if (typeof message.content !== "string" || !message.content.trim())
      continue;

    await db
      .insert(conversationMessages)
      .values({
        messageId: message.id,
        threadId,
        submitSeq: latestRun.submitSeq,
        message: {
          id: message.id,
          role: "assistant",
          content: message.content,
        },
      })
      .onConflictDoNothing();
  }
}

export async function conversationSnapshot(threadId: string) {
  const [conversation] = await db
    .select({ threadId: conversations.threadId })
    .from(conversations)
    .where(eq(conversations.threadId, threadId));
  if (!conversation) return null;

  const savedRuns = await db
    .select()
    .from(conversationRuns)
    .where(eq(conversationRuns.threadId, threadId))
    .orderBy(asc(conversationRuns.submitSeq));
  const runs = [...savedRuns];
  const latest = runs.at(-1);
  if (latest && ["dispatching", "running"].includes(latest.status)) {
    runs[runs.length - 1] = await reconcileRun(latest);
  }

  let interrupts: ReturnType<typeof interruptsFromState> = [];
  try {
    const state = await readThreadState(threadId);
    interrupts = interruptsFromState(state);
    await saveCompletedMessages(threadId, state);
  } catch (error) {
    if (
      runs.some(
        (run) =>
          run.status !== "prepared" && run.status !== "submission_unknown",
      )
    )
      throw error;
  }

  const [messages, outputs] = await Promise.all([
    db
      .select({ message: conversationMessages.message })
      .from(conversationMessages)
      .where(eq(conversationMessages.threadId, threadId))
      .orderBy(
        asc(conversationMessages.submitSeq),
        asc(conversationMessages.createdAt),
      ),
    db
      .select()
      .from(workflowOutputs)
      .where(eq(workflowOutputs.threadId, threadId))
      .orderBy(asc(workflowOutputs.outputSeq)),
  ]);

  return {
    threadId,
    messages: messages.map((row) => row.message),
    outputs: outputs.map((row) => ({
      id: row.id,
      aguiRunId: row.aguiRunId,
      workflowCallId: row.workflowCallId,
      outputSeq: row.outputSeq,
      toolCallId: row.workflowCallId,
      ...row.payload,
    })),
    runs: runs.map((row) => ({
      runId: row.aguiRunId,
      aegraRunId: row.aegraRunId,
      status: row.status,
      messageId: row.messageId,
    })),
    interrupts,
  };
}
