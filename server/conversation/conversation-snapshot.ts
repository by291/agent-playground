import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "../db/database";
import {
  conversationMessages,
  conversationRuns,
  conversations,
} from "../db/schema";
import { externalTaskSnapshots } from "./external-tasks";
import { workflowOutputs } from "../db/workflow-schema";
import { presentConversationTitle } from "./titles";
import { workflowReplyMessages } from "../../shared/workflow-output";

export async function conversationSnapshot(threadId: string) {
  const [conversation] = await db
    .select({
      threadId: conversations.threadId,
      title: conversations.title,
      contextUsage: conversations.contextUsage,
      modelId: conversations.modelId,
    })
    .from(conversations)
    .where(
      and(
        eq(conversations.threadId, threadId),
        isNull(conversations.deletedAt),
      ),
    );

  if (!conversation) {
    return null;
  }

  const [runs, messages, outputs, externalTasks] = await Promise.all([
    db
      .select({
        runId: conversationRuns.aguiRunId,
        aegraRunId: conversationRuns.aegraRunId,
        status: conversationRuns.status,
        messageId: conversationRuns.messageId,
        interrupts: conversationRuns.interrupts,
        modelId: conversationRuns.modelId,
      })
      .from(conversationRuns)
      .where(eq(conversationRuns.threadId, threadId))
      .orderBy(asc(conversationRuns.submitSeq)),
    db
      .select({
        message: conversationMessages.message,
        createdAt: conversationMessages.createdAt,
      })
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
    externalTaskSnapshots(threadId),
  ]);

  return {
    threadId,
    externalTasks,
    title: presentConversationTitle(
      conversation.title,
      messages.find((row) => row.message.role === "user")?.message,
    ),
    contextUsage: conversation.contextUsage,
    modelId: conversation.modelId,
    messages: messages.map((row) => row.message),
    messageTimestamps: Object.fromEntries<string>([
      ...messages.map(
        (row) => [row.message.id, row.createdAt.toISOString()] as const,
      ),
      ...outputs.flatMap((row) =>
        workflowReplyMessages(row.payload).map(
          (reply) => [reply.id, row.createdAt.toISOString()] as const,
        ),
      ),
    ]),
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
      modelId: run.modelId,
    })),
    interrupts: runs.at(-1)?.interrupts ?? [],
  };
}
