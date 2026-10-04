import type { Interrupt, RunAgentInput } from "@ag-ui/client";
import { and, eq, inArray } from "drizzle-orm";
import type { db } from "../db/database";
import { workflowOutputs } from "../db/workflow-schema";
import type { RunRow } from "../db/schema";
import { SubmissionError } from "./errors";
import {
  parseSqlReview,
  sqlReviewResponseSchema,
} from "../../shared/sql-review";

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
    const review = parseSqlReview(interrupt);
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
    (interrupt) => parseSqlReview(interrupt) !== null,
  );

  if (
    run?.status !== "interrupted" ||
    !interrupts.length ||
    !submitted.length ||
    submittedIds.size !== submitted.length ||
    (!allowsPartial && interrupts.length !== submitted.length) ||
    [...submittedIds].some((id) => !currentIds.has(id)) ||
    !(await reviewOutputsPersisted(input.threadId, interrupts, database))
  ) {
    throw new SubmissionError("Review is no longer current", 409);
  }

  for (const interrupt of interrupts) {
    const review = parseSqlReview(interrupt);

    if (!review) {
      continue;
    }

    const entry = submitted.find((item) => item.interruptId === interrupt.id);

    if (!entry) {
      continue;
    }

    const response = sqlReviewResponseSchema.safeParse(entry?.payload);

    if (!response.success) {
      throw new SubmissionError("Invalid SQL review response", 400);
    }

    const value = response.data;
    const current =
      value.workflowCallId === review.workflowCallId &&
      value.revision === review.revision &&
      value.round === review.round;

    if (!current) {
      throw new SubmissionError("SQL review is no longer current", 409);
    }

    if (value.action === "accept" && !review.check.passed) {
      throw new SubmissionError(
        "SQL must pass its check before submission",
        400,
      );
    }
  }
}

export function sqlFeedbackMessage(input: RunAgentInput) {
  const messages = (input.resume ?? []).flatMap((entry) => {
    const parsed = sqlReviewResponseSchema.safeParse(entry.payload);

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
    throw new SubmissionError(
      "Send feedback to one SQL workflow at a time",
      400,
    );
  }

  return messages[0] ?? null;
}
