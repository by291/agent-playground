import type { Interrupt, RunAgentInput } from "@ag-ui/client";
import { and, eq, inArray } from "drizzle-orm";
import type { db } from "../../db/database.js";
import { workflowOutputs } from "../../db/workflow-schema.js";
import type { RunRow } from "../../db/conversation-schema.js";
import {
  parseExternalWait,
  isExternalTaskTerminal,
} from "../../../../shared/external-task.js";
import { externalTasks } from "../../db/external-task-schema.js";
import { isDeepStrictEqual } from "node:util";
import { SubmissionError } from "../errors.js";
import {
  parseWorkflowReview,
  workflowReviewResponseSchema,
} from "../../../../shared/workflow-review.js";

function workflowCallId(interrupt: Interrupt): string | null {
  const metadata: unknown = interrupt.metadata?.langgraph;

  if (!metadata || typeof metadata !== "object" || !("raw" in metadata)) {
    return null;
  }

  const raw: unknown = metadata.raw;

  if (!raw || typeof raw !== "object" || !("workflowCallId" in raw)) {
    return null;
  }

  return typeof raw.workflowCallId === "string" ? raw.workflowCallId : null;
}

async function reviewOutputsPersisted(
  threadId: string,
  interrupts: Interrupt[],
  database: Pick<typeof db, "select">,
) {
  const callIds = interrupts.map(workflowCallId);

  if (!callIds.length || !callIds.every((id): id is string => id !== null)) {
    return false;
  }

  const saved = await database
    .select({
      callId: workflowOutputs.workflowCallId,
      stepId: workflowOutputs.stepId,
    })
    .from(workflowOutputs)
    .where(
      and(
        eq(workflowOutputs.threadId, threadId),
        inArray(workflowOutputs.workflowCallId, callIds),
      ),
    );

  return interrupts.every((interrupt, index) => {
    const review = parseWorkflowReview(interrupt);
    const stepId = review?.outputStepId ?? "review";

    return saved.some(
      (row) => row.callId === callIds[index] && row.stepId === stepId,
    );
  });
}

export async function validateReview(
  input: RunAgentInput,
  run: RunRow | null,
  database: Pick<typeof db, "select">,
): Promise<void> {
  const interrupts = run?.interrupts ?? [];
  const submitted = input.resume ?? [];
  const currentIds = new Set(interrupts.map((interrupt) => interrupt.id));
  const submittedIds = new Set(submitted.map((entry) => entry.interruptId));
  const allowsPartial = interrupts.some(
    (interrupt) =>
      parseWorkflowReview(interrupt) !== null ||
      parseExternalWait(interrupt) !== null,
  );
  const userInterrupts = interrupts.filter(
    (interrupt) => !parseExternalWait(interrupt),
  );
  const invalidReviewShape =
    run?.status !== "interrupted" ||
    !interrupts.length ||
    !submitted.length ||
    submittedIds.size !== submitted.length ||
    (!allowsPartial && interrupts.length !== submitted.length);

  if (invalidReviewShape) {
    throw new SubmissionError("Review is no longer current", 409);
  }

  // External waits are resumed by the worker, even when a user review shares the pause.
  const targetsUnavailableInterrupt = [...submittedIds].some(
    (id) =>
      !currentIds.has(id) ||
      interrupts.some(
        (interrupt) => interrupt.id === id && parseExternalWait(interrupt),
      ),
  );

  if (targetsUnavailableInterrupt) {
    throw new SubmissionError("Review is no longer current", 409);
  }

  // Admission holds the conversation lock while checking the published review outputs.
  if (
    !(await reviewOutputsPersisted(input.threadId, userInterrupts, database))
  ) {
    throw new SubmissionError("Review is no longer current", 409);
  }

  for (const interrupt of interrupts) {
    const review = parseWorkflowReview(interrupt);

    if (!review) {
      continue;
    }

    const entry = submitted.find((item) => item.interruptId === interrupt.id);

    if (!entry) {
      continue;
    }

    const response = workflowReviewResponseSchema.safeParse(entry.payload);

    if (!response.success) {
      throw new SubmissionError("Invalid workflow review response", 400);
    }

    const responseValue = response.data;
    const matchesCurrentReview =
      responseValue.workflowCallId === review.workflowCallId &&
      responseValue.revision === review.revision &&
      responseValue.round === review.round;

    if (!matchesCurrentReview) {
      throw new SubmissionError("Workflow review is no longer current", 409);
    }

    if (responseValue.action === "accept" && !review.canAccept) {
      throw new SubmissionError(
        review.blockedReason ?? "This version cannot be accepted",
        400,
      );
    }
  }
}

export function workflowFeedbackMessage(input: RunAgentInput) {
  const messages = (input.resume ?? []).flatMap((entry) => {
    const parsed = workflowReviewResponseSchema.safeParse(entry.payload);

    return parsed.success && parsed.data.action === "message"
      ? [
          {
            id: parsed.data.messageId,
            role: "user" as const,
            content: parsed.data.message,
          },
        ]
      : [];
  });

  if (messages.length > 1) {
    throw new SubmissionError("Send feedback to one workflow at a time", 400);
  }

  return messages[0] ?? null;
}

export async function validateExternalContinuation(
  input: RunAgentInput,
  run: RunRow | null,
  database: Pick<typeof db, "select">,
  taskId: string,
) {
  const entry = input.resume?.[0];
  const wait = run?.interrupts
    .map(parseExternalWait)
    .find((value) => value?.interruptId === entry?.interruptId);
  const [task] = await database
    .select()
    .from(externalTasks)
    .where(eq(externalTasks.taskId, taskId));
  const expected = task
    ? { ...task.update, kind: "external_task_result", taskId }
    : null;

  if (
    run?.status !== "interrupted" ||
    input.resume?.length !== 1 ||
    !task ||
    task.continuationRunId ||
    task.threadId !== input.threadId
  ) {
    throw new SubmissionError(
      "External task continuation is no longer current",
      409,
    );
  }

  const matchesPausedTask =
    wait?.taskId === taskId && wait.workflowCallId === task.workflowCallId;

  if (
    !matchesPausedTask ||
    !isExternalTaskTerminal(task.status) ||
    !isDeepStrictEqual(entry?.payload, expected)
  ) {
    throw new SubmissionError(
      "External task continuation is no longer current",
      409,
    );
  }
}
