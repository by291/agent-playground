import { randomBytes, timingSafeEqual } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "../db/database";
import { conversations, conversationRuns } from "../db/schema";
import { externalTaskEvents, externalTasks } from "../db/external-task-schema";
import {
  isExternalTaskTerminal,
  type ExternalTaskRegistration,
  type ExternalTaskUpdate,
} from "../../shared/external-task";
import { SubmissionError } from "./errors";
import { notifyConversation } from "./changes";

export async function registerExternalTask(input: ExternalTaskRegistration) {
  return db.transaction(async (tx) => {
    const [conversation] = await tx
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.threadId, input.threadId),
          isNull(conversations.deletedAt),
        ),
      )
      .for("update");
    const [run] = await tx
      .select()
      .from(conversationRuns)
      .where(
        and(
          eq(conversationRuns.aguiRunId, input.runId),
          eq(conversationRuns.threadId, input.threadId),
        ),
      );

    if (!conversation || !run) {
      throw new SubmissionError(
        "External task needs an existing conversation run",
        409,
      );
    }

    const [existing] = await tx
      .select()
      .from(externalTasks)
      .where(eq(externalTasks.taskId, input.taskId));

    if (existing) {
      if (
        existing.threadId !== input.threadId ||
        existing.workflowCallId !== input.workflowCallId ||
        existing.stepId !== input.stepId ||
        existing.label !== input.label
      ) {
        throw new SubmissionError("External task identity conflict", 409);
      }

      return { taskId: existing.taskId, callbackToken: existing.callbackToken };
    }

    const callbackToken = randomBytes(32).toString("hex");

    await tx.insert(externalTasks).values({
      ...input,
      callbackToken,
      status: "queued",
      update: {
        revision: 0,
        status: "queued",
        stage: "queued",
        message: "Waiting for external updates",
        progress: 0,
      },
    });
    await notifyConversation(tx, input.threadId);

    return { taskId: input.taskId, callbackToken };
  });
}

export async function updateExternalTask(
  taskId: string,
  token: string,
  update: ExternalTaskUpdate,
) {
  return db.transaction(async (tx) => {
    const [task] = await tx
      .select()
      .from(externalTasks)
      .where(eq(externalTasks.taskId, taskId))
      .for("update");
    const supplied = Buffer.from(token);
    const expected = Buffer.from(task?.callbackToken ?? "");

    if (
      !task ||
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    ) {
      throw new SubmissionError("Invalid task callback credential", 401);
    }

    const [conversation] = await tx
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.threadId, task.threadId),
          isNull(conversations.deletedAt),
        ),
      );

    if (!conversation) {
      throw new SubmissionError("Conversation not found", 404);
    }

    if (update.revision < task.revision) {
      return { accepted: false };
    }

    if (update.revision === task.revision) {
      if (!isDeepStrictEqual(update, task.update)) {
        throw new SubmissionError("External task revision conflict", 409);
      }

      return { accepted: false };
    }

    if (isExternalTaskTerminal(task.status)) {
      throw new SubmissionError("External task is already terminal", 409);
    }

    await tx
      .insert(externalTaskEvents)
      .values({ taskId, revision: update.revision, update });
    await tx
      .update(externalTasks)
      .set({ revision: update.revision, status: update.status, update })
      .where(eq(externalTasks.taskId, taskId));
    await notifyConversation(tx, task.threadId);

    return { accepted: true };
  });
}

export async function externalTaskSnapshots(threadId: string) {
  const tasks = await db
    .select({
      task: externalTasks,
      continuationStatus: conversationRuns.status,
    })
    .from(externalTasks)
    .leftJoin(
      conversationRuns,
      eq(externalTasks.continuationRunId, conversationRuns.aguiRunId),
    )
    .where(eq(externalTasks.threadId, threadId));
  const events = await db
    .select({
      taskId: externalTaskEvents.taskId,
      update: externalTaskEvents.update,
    })
    .from(externalTaskEvents)
    .innerJoin(
      externalTasks,
      eq(externalTaskEvents.taskId, externalTasks.taskId),
    )
    .where(eq(externalTasks.threadId, threadId))
    .orderBy(asc(externalTaskEvents.revision));

  return tasks.map(({ task, continuationStatus }) => ({
    taskId: task.taskId,
    workflowCallId: task.workflowCallId,
    label: task.label,
    revision: task.revision,
    status: task.status,
    stage: task.update.stage,
    message: task.update.message,
    ...(task.update.progress !== undefined
      ? { progress: task.update.progress }
      : {}),
    ...(task.update.error ? { error: task.update.error } : {}),
    continuationStatus,
    history: events
      .filter(
        (event) =>
          event.taskId === task.taskId &&
          event.update.revision <= task.revision,
      )
      .map((event) => event.update),
  }));
}
