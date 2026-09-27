import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { isDeepStrictEqual } from "node:util";
import { db } from "../db/database";
import {
  conversationMessages,
  conversationRuns,
  conversations,
  type RunRow,
} from "../db/schema";

interface RunSubmission {
  threadId: string;
  runId: string;
  messageId: string;
  request: unknown;
  userMessage: unknown;
  isResume: boolean;
}

export async function admitRun({
  threadId,
  runId,
  messageId,
  request,
  userMessage,
  isResume,
}: RunSubmission): Promise<{ row: RunRow; fresh: boolean }> {
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
        throw new Error("Conflicting submission IDs or payload");
      }
      return { row, fresh: false };
    }

    const pending = await tx
      .select({ status: conversationRuns.status })
      .from(conversationRuns)
      .where(
        and(
          eq(conversationRuns.threadId, threadId),
          inArray(conversationRuns.status, [
            "prepared",
            "dispatching",
            "running",
            "interrupted",
            "submission_unknown",
          ]),
        ),
      );

    const hasActiveRun = pending.some((row) => row.status !== "interrupted");
    if (hasActiveRun || (!isResume && pending.length > 0)) {
      throw new Error("Conversation has an active run or review");
    }

    const [row] = await tx
      .insert(conversationRuns)
      .values({
        aguiRunId: runId,
        threadId,
        submitSeq: conversation.nextSubmitSeq,
        messageId,
        request,
        status: "prepared",
      })
      .returning();

    if (!row) {
      throw new Error("Conversation run insertion failed");
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
      .set({ nextSubmitSeq: conversation.nextSubmitSeq + 1 })
      .where(eq(conversations.threadId, threadId));
    return { row, fresh: true };
  });
}

export async function claimPrepared(runId: string): Promise<boolean> {
  const rows = await db
    .update(conversationRuns)
    .set({ status: "dispatching" })
    .where(
      and(
        eq(conversationRuns.aguiRunId, runId),
        eq(conversationRuns.status, "prepared"),
      ),
    )
    .returning({ id: conversationRuns.aguiRunId });
  return rows.length === 1;
}

export async function recordAegraRun(
  runId: string,
  aegraRunId: string,
): Promise<void> {
  const rows = await db
    .update(conversationRuns)
    .set({ aegraRunId, status: "running" })
    .where(
      and(
        eq(conversationRuns.aguiRunId, runId),
        or(
          eq(conversationRuns.aegraRunId, aegraRunId),
          isNull(conversationRuns.aegraRunId),
        ),
      ),
    )
    .returning({ id: conversationRuns.aguiRunId });

  if (rows.length !== 1) {
    throw new Error("Aegra run mapping conflict");
  }
}
