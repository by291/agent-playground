import { and, asc, desc, eq, exists, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Message } from "@ag-ui/client";
import { db } from "../../db/database.js";
import {
  conversationMessages,
  conversationRuns,
  conversations,
} from "../../db/conversation-schema.js";
import { isRunActive, type RunStatus } from "../../../../shared/run-status.js";
import { SubmissionError } from "../errors.js";
import { presentConversationTitle } from "./titles.js";

const cursorSchema = z.object({
  updatedAt: z.string().datetime(),
  threadId: z.string().min(1).max(256),
});
const pageSize = 30;

export function parseConversationCursor(value: string | undefined) {
  if (value === undefined) {
    return null;
  }

  try {
    if (value.length > 1024) {
      throw new Error("Cursor too long");
    }

    return cursorSchema.parse(JSON.parse(value));
  } catch {
    throw new SubmissionError("Invalid conversation cursor", 400);
  }
}

export async function listConversations(
  cursor: ReturnType<typeof parseConversationCursor>,
) {
  const boundary = cursor
    ? or(
        lt(conversations.updatedAt, new Date(cursor.updatedAt)),
        and(
          eq(conversations.updatedAt, new Date(cursor.updatedAt)),
          lt(conversations.threadId, cursor.threadId),
        ),
      )
    : undefined;
  const latestStatus = db
    .select({ status: conversationRuns.status })
    .from(conversationRuns)
    .where(eq(conversationRuns.threadId, conversations.threadId))
    .orderBy(desc(conversationRuns.submitSeq))
    .limit(1);
  // Upload intents reserve identities before admission; legacy messages need no run row.
  const savedMessages = db
    .select({ id: conversationMessages.messageId })
    .from(conversationMessages)
    .where(eq(conversationMessages.threadId, conversations.threadId));
  const firstMessage = db
    .select({ message: conversationMessages.message })
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.threadId, conversations.threadId),
        sql`${conversationMessages.message}->>'role' = 'user'`,
      ),
    )
    .orderBy(
      asc(conversationMessages.submitSeq),
      asc(conversationMessages.messageOrder),
      asc(conversationMessages.createdAt),
    )
    .limit(1);

  const rows = await db
    .select({
      threadId: conversations.threadId,
      title: conversations.title,
      createdAt: conversations.createdAt,
      updatedAt: conversations.updatedAt,
      status: sql<RunStatus | null>`(${latestStatus})`,
      firstMessage: sql<Message | null>`(${firstMessage})`,
    })
    .from(conversations)
    .where(
      and(isNull(conversations.deletedAt), exists(savedMessages), boundary),
    )
    .orderBy(desc(conversations.updatedAt), desc(conversations.threadId))
    .limit(pageSize + 1);
  const page = rows
    .slice(0, pageSize)
    .map(({ firstMessage: message, ...row }) => ({
      ...row,
      title: presentConversationTitle(row.title, message),
    }));
  const last = page.at(-1);

  return {
    conversations: page,
    nextCursor:
      rows.length > pageSize && last
        ? JSON.stringify({
            updatedAt: last.updatedAt.toISOString(),
            threadId: last.threadId,
          })
        : null,
  };
}

export async function conversationExists(threadId: string) {
  const [row] = await db
    .select({ threadId: conversations.threadId })
    .from(conversations)
    .where(
      and(
        eq(conversations.threadId, threadId),
        isNull(conversations.deletedAt),
      ),
    );

  return !!row;
}

export async function renameConversation(threadId: string, title: string) {
  const [row] = await db
    .update(conversations)
    .set({ title })
    .where(
      and(
        eq(conversations.threadId, threadId),
        isNull(conversations.deletedAt),
      ),
    )
    .returning({
      threadId: conversations.threadId,
      title: conversations.title,
    });

  if (!row) {
    throw new SubmissionError("Conversation not found", 404);
  }

  return row;
}

export async function deleteConversation(threadId: string) {
  await db.transaction(async (tx) => {
    // Use admission's lock so deletion and a new run cannot both succeed.
    const [conversation] = await tx
      .select()
      .from(conversations)
      .where(eq(conversations.threadId, threadId))
      .for("update");

    if (!conversation || conversation.deletedAt) {
      throw new SubmissionError("Conversation not found", 404);
    }

    const [run] = await tx
      .select({ status: conversationRuns.status })
      .from(conversationRuns)
      .where(eq(conversationRuns.threadId, threadId))
      .orderBy(desc(conversationRuns.submitSeq))
      .limit(1);

    if (
      run &&
      (isRunActive(run.status) || run.status === "submission_unknown")
    ) {
      throw new SubmissionError(
        "Wait for the conversation run to finish before deleting it",
        409,
      );
    }

    await tx
      .update(conversations)
      .set({ deletedAt: new Date() })
      .where(eq(conversations.threadId, threadId));
  });
}

export async function deleteAllConversations() {
  await db.transaction(async (tx) => {
    // Match admission's lock and acquire the entire batch in a stable order.
    const targets = await tx
      .select({ threadId: conversations.threadId })
      .from(conversations)
      .where(isNull(conversations.deletedAt))
      .orderBy(asc(conversations.threadId))
      .for("update");

    if (targets.length === 0) {
      return;
    }

    const threadIds = sql.param(targets.map((target) => target.threadId));
    // A separate statement sees admissions committed while row locks were waiting.
    const latestRuns = await tx
      .selectDistinctOn([conversationRuns.threadId], {
        status: conversationRuns.status,
      })
      .from(conversationRuns)
      .where(sql`${conversationRuns.threadId} = ANY(${threadIds}::text[])`)
      .orderBy(conversationRuns.threadId, desc(conversationRuns.submitSeq));
    const hasUnfinishedRun = latestRuns.some(
      (run) => isRunActive(run.status) || run.status === "submission_unknown",
    );

    if (hasUnfinishedRun) {
      throw new SubmissionError(
        "Wait for all conversation runs to finish before clearing conversations",
        409,
      );
    }

    // Only the locked batch is deleted; newly created conversations are unaffected.
    await tx
      .update(conversations)
      .set({ deletedAt: new Date() })
      .where(sql`${conversations.threadId} = ANY(${threadIds}::text[])`);
  });
}
