import { asc, desc, eq } from "drizzle-orm";
import { db } from "../db/database";
import {
  conversationMessages,
  conversationRuns,
  conversations,
} from "../db/schema";
import { workflowOutputs } from "../db/workflow-schema";

export async function listConversations() {
  return db
    .select({ threadId: conversations.threadId })
    .from(conversations)
    .orderBy(desc(conversations.createdAt))
    .limit(50);
}

export async function conversationSnapshot(threadId: string) {
  const [conversation] = await db
    .select({
      threadId: conversations.threadId,
      contextUsage: conversations.contextUsage,
    })
    .from(conversations)
    .where(eq(conversations.threadId, threadId));

  if (!conversation) {
    return null;
  }

  const [runs, messages, outputs] = await Promise.all([
    db
      .select({
        runId: conversationRuns.aguiRunId,
        aegraRunId: conversationRuns.aegraRunId,
        status: conversationRuns.status,
        messageId: conversationRuns.messageId,
        interrupts: conversationRuns.interrupts,
      })
      .from(conversationRuns)
      .where(eq(conversationRuns.threadId, threadId))
      .orderBy(asc(conversationRuns.submitSeq)),
    db
      .select({ message: conversationMessages.message })
      .from(conversationMessages)
      .where(eq(conversationMessages.threadId, threadId))
      .orderBy(
        asc(conversationMessages.submitSeq),
        asc(conversationMessages.messageOrder),
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
    contextUsage: conversation.contextUsage,
    messages: messages.map((row) => row.message),
    outputs: outputs.map((row) => ({
      id: row.id,
      aguiRunId: row.aguiRunId,
      workflowCallId: row.workflowCallId,
      outputSeq: row.outputSeq,
      toolCallId: row.workflowCallId,
      ...row.payload,
    })),
    runs: runs.map((run) => ({
      runId: run.runId,
      aegraRunId: run.aegraRunId,
      status: run.status,
      messageId: run.messageId,
    })),
    interrupts: runs.at(-1)?.interrupts ?? [],
  };
}
