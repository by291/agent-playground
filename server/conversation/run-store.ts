import { and, desc, eq, isNull, or } from "drizzle-orm";
import type { Message, RunAgentInput } from "@ag-ui/client";
import { isDeepStrictEqual } from "node:util";
import { db } from "../db/database";
import {
  conversationMessages,
  conversationRuns,
  conversations,
  type RunRow,
} from "../db/schema";
import { SubmissionError } from "./errors";
import {
  isRunActive,
  isRunFinished,
  type RunStatus,
} from "../../shared/run-status";
import { validateReview, validateExternalContinuation } from "./reviews";
import { externalTasks } from "../db/external-task-schema";
import { defaultConversationTitle } from "./titles";

interface RunSubmission {
  threadId: string;
  runId: string;
  messageId: string;
  request: RunAgentInput;
  userMessage: Message | null;
  isResume: boolean;
  externalTaskId?: string;
}

const dispatchOwners = new Map<string, symbol>();

export async function admitRun({
  threadId,
  runId,
  messageId,
  request,
  userMessage,
  isResume,
  externalTaskId,
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

export async function claimPreparedDispatch(
  runId: string,
): Promise<(() => void) | null> {
  if (dispatchOwners.has(runId)) {
    return null;
  }

  const owner = Symbol(runId);

  // Register before the claim commits so recovery cannot see an ownerless live dispatch.
  dispatchOwners.set(runId, owner);

  const release = () => {
    if (dispatchOwners.get(runId) === owner) {
      dispatchOwners.delete(runId);
    }
  };

  try {
    if (!(await claimPrepared(runId))) {
      release();

      return null;
    }

    return release;
  } catch (error) {
    release();
    throw error;
  }
}

export function hasRunDispatchOwner(runId: string): boolean {
  return dispatchOwners.has(runId);
}

export async function recordAegraRun(
  runId: string,
  aegraRunId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(conversationRuns)
      .where(eq(conversationRuns.aguiRunId, runId))
      .for("update");

    if (!row || (row.aegraRunId && row.aegraRunId !== aegraRunId)) {
      throw new Error("Aegra run mapping conflict");
    }

    // Recovery may finish the run before its creation callback reaches the database.
    await tx
      .update(conversationRuns)
      .set({
        aegraRunId,
        status: isRunFinished(row.status) ? row.status : "running",
      })
      .where(eq(conversationRuns.aguiRunId, runId));
  });
}

export async function latestRun(threadId: string): Promise<RunRow | null> {
  const [row] = await db
    .select()
    .from(conversationRuns)
    .where(eq(conversationRuns.threadId, threadId))
    .orderBy(desc(conversationRuns.submitSeq))
    .limit(1);

  return row ?? null;
}

export async function saveRunObservation(
  expected: RunRow,
  observation: { status: RunStatus; aegraRunId: string | null },
): Promise<RunRow> {
  // An upstream read cannot overwrite a callback or a newer terminal observation.
  const [updated] = await db
    .update(conversationRuns)
    .set(observation)
    .where(
      and(
        eq(conversationRuns.aguiRunId, expected.aguiRunId),
        eq(conversationRuns.status, expected.status),
        expected.aegraRunId === null
          ? isNull(conversationRuns.aegraRunId)
          : eq(conversationRuns.aegraRunId, expected.aegraRunId),
      ),
    )
    .returning();

  if (updated) {
    return updated;
  }

  const [current] = await db
    .select()
    .from(conversationRuns)
    .where(eq(conversationRuns.aguiRunId, expected.aguiRunId));

  if (!current) {
    throw new Error("Conversation run disappeared during recovery");
  }

  return current;
}
