import { and, desc, eq, or } from "drizzle-orm";
import type { Message, RunAgentInput } from "@ag-ui/client";
import { isDeepStrictEqual } from "node:util";
import { db } from "../../db/database.js";
import {
  conversationMessages,
  conversationRuns,
  conversations,
  type RunRow,
} from "../../db/conversation-schema.js";
import { SubmissionError } from "../errors.js";
import { isRunActive } from "../../../../shared/run-status.js";
import {
  validateReview,
  validateExternalContinuation,
} from "./review-validation.js";
import { externalTasks } from "../../db/external-task-schema.js";
import { defaultConversationTitle } from "../history/titles.js";
import type { AgentInfo } from "../../../../shared/agent-info.js";
import { availableModelId, requestedModelId } from "./model-validation.js";

interface RunSubmission {
  threadId: string;
  runId: string;
  messageId: string;
  request: RunAgentInput;
  userMessage: Message | null;
  isResume: boolean;
  externalTaskId?: string;
  agentInfo?: AgentInfo;
}

export async function admitRun({
  threadId,
  runId,
  messageId,
  request,
  userMessage,
  isResume,
  externalTaskId,
  agentInfo,
}: RunSubmission): Promise<{ row: RunRow }> {
  return db.transaction(async (tx) => {
    await tx.insert(conversations).values({ threadId }).onConflictDoNothing();

    // The conversation row serializes admission with other submissions.
    const [conversation] = await tx
      .select()
      .from(conversations)
      .where(eq(conversations.threadId, threadId))
      .for("update");

    if (!conversation) {
      throw new Error("Conversation admission failed");
    }

    if (conversation.deletedAt) {
      throw new SubmissionError("Conversation not found", 404);
    }

    const existing = await tx
      .select()
      .from(conversationRuns)
      .where(
        or(
          eq(conversationRuns.aguiRunId, runId),
          and(
            eq(conversationRuns.threadId, threadId),
            eq(conversationRuns.messageId, messageId),
          ),
        ),
      );

    if (existing.length) {
      const row = existing[0];

      if (!row) {
        throw new Error("Conversation submission lookup failed");
      }

      const sameSubmission =
        existing.length === 1 &&
        row.aguiRunId === runId &&
        row.threadId === threadId &&
        row.messageId === messageId &&
        isDeepStrictEqual(row.request, request);

      if (!sameSubmission) {
        throw new SubmissionError("Conflicting submission IDs or payload", 409);
      }

      return { row };
    }

    const [current] = await tx
      .select()
      .from(conversationRuns)
      .where(eq(conversationRuns.threadId, threadId))
      .orderBy(desc(conversationRuns.submitSeq))
      .limit(1);

    // Historical pauses remain immutable; only the newest run can block admission.
    if (
      current &&
      (isRunActive(current.status) ||
        current.status === "submission_unknown" ||
        (!isResume && current.status === "interrupted"))
    ) {
      throw new SubmissionError(
        "Conversation has an active run or review",
        409,
      );
    }

    // Existing prepared submissions returned above. Only a new review is validated,
    // under the same conversation lock that protects its admission.
    if (isResume) {
      if (externalTaskId) {
        await validateExternalContinuation(
          request,
          current ?? null,
          tx,
          externalTaskId,
        );
      } else {
        await validateReview(request, current ?? null, tx);
      }
    }

    // Resume the checkpoint with the model that produced it. Legacy direct
    // admissions stay nullable; live admissions resolve the Python catalog here.
    const requestedModel = requestedModelId(request);
    let modelId: string | null = null;

    if (isResume) {
      modelId = current?.modelId ?? null;

      if (modelId && requestedModel && requestedModel !== modelId) {
        throw new SubmissionError("Cannot change the paused run model", 409);
      }
    } else if (agentInfo) {
      modelId = availableModelId(
        agentInfo,
        requestedModel ?? conversation.modelId,
      );
    }

    if (isResume && modelId && agentInfo) {
      availableModelId(agentInfo, modelId);
    }

    const [row] = await tx
      .insert(conversationRuns)
      .values({
        aguiRunId: runId,
        threadId,
        submitSeq: conversation.nextSubmitSeq,
        messageId,
        request,
        modelId,
        status: "prepared",
      })
      .returning();

    if (!row) {
      throw new Error("Conversation run insertion failed");
    }

    if (externalTaskId) {
      await tx
        .update(externalTasks)
        .set({ continuationRunId: runId })
        .where(eq(externalTasks.taskId, externalTaskId));
    }

    if (userMessage) {
      await tx.insert(conversationMessages).values({
        messageId,
        threadId,
        submitSeq: conversation.nextSubmitSeq,
        message: userMessage,
      });
    }

    await tx
      .update(conversations)
      .set({
        nextSubmitSeq: conversation.nextSubmitSeq + 1,
        updatedAt: new Date(),
        ...(!isResume && modelId ? { modelId } : {}),
        ...(conversation.nextSubmitSeq === 1 &&
        userMessage &&
        conversation.title === "Untitled conversation"
          ? { title: defaultConversationTitle(userMessage) }
          : {}),
      })
      .where(eq(conversations.threadId, threadId));

    return { row };
  });
}
