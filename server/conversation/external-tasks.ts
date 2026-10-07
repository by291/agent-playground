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
import { aegraUrl } from "../agent/client";

function historyUpdate(update: ExternalTaskUpdate) {
  const history = { ...update };

  // Child text is a complete streamed snapshot; retain it only on the task row.
  delete history.outputs;

  return history;
}

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

    await tx.insert(externalTaskEvents).values({
      taskId,
      revision: update.revision,
      update: historyUpdate(update),
    });
    await tx
      .update(externalTasks)
      .set({ revision: update.revision, status: update.status, update })
      .where(eq(externalTasks.taskId, taskId));
    await notifyConversation(tx, task.threadId);

    return { accepted: true };
  });
}

export async function controlExternalTask(
  taskId: string,
  action: "input" | "cancel",
  input?: string,
) {
  const [owned] = await db
    .select({ task: externalTasks })
    .from(externalTasks)
    .innerJoin(
      conversations,
      eq(externalTasks.threadId, conversations.threadId),
    )
    .where(
      and(eq(externalTasks.taskId, taskId), isNull(conversations.deletedAt)),
    );

  if (!owned) {
    throw new SubmissionError("External task not found", 404);
  }

  const task = owned.task;

  if (task.update.kind !== "a2a") {
    throw new SubmissionError(
      "External task does not support agent controls",
      409,
    );
  }

  if (isExternalTaskTerminal(task.status)) {
    throw new SubmissionError("External task is already terminal", 409);
  }

  if (action === "input" && task.status !== "input_required") {
    throw new SubmissionError("External task is not waiting for input", 409);
  }

  const configuredCoordinatorUrl = process.env.A2A_DEMO_API_URL?.trim();
  let coordinatorUrl = `${aegraUrl}/a2a-demo`;

  if (configuredCoordinatorUrl) {
    coordinatorUrl = configuredCoordinatorUrl;
  }

  // A callback may finish the task after this read; the coordinator arbitrates
  // that race. Its callback, not this request, owns the persisted task status.
  return fetch(
    `${coordinatorUrl.replace(/\/$/, "")}/jobs/${encodeURIComponent(taskId)}/${action}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${task.callbackToken}`,
        "Content-Type": "application/json",
      },
      ...(action === "input" ? { body: JSON.stringify({ input }) } : {}),
      signal: AbortSignal.timeout(10000),
    },
  );
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
    ...(task.update.kind ? { kind: task.update.kind } : {}),
    ...(task.update.outputs ? { outputs: task.update.outputs } : {}),
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
      .map((event) => historyUpdate(event.update)),
  }));
}
