import type { Interrupt, ResumeEntry } from "@ag-ui/client";
import { z } from "zod";

const reviewPayloadSchema = z.object({
  kind: z.literal("experiment_plan_review"),
  workflowCallId: z.string().optional(),
  title: z.string(),
  steps: z.string().array(),
});
const reviewMetadataSchema = z.object({ raw: reviewPayloadSchema });

export interface PlanReview {
  interruptId: string;
  workflowCallId?: string;
  title: string;
  steps: string[];
}

export interface PlanReviewResponse extends PlanReview {
  decision: "approve" | "reject";
}

export function parsePlanReview(interrupt: Interrupt): PlanReview | null {
  const parsed = reviewMetadataSchema.safeParse(interrupt.metadata?.langgraph);

  if (!parsed.success) {
    return null;
  }

  const { title, steps, workflowCallId } = parsed.data.raw;

  return {
    interruptId: interrupt.id,
    ...(workflowCallId ? { workflowCallId } : {}),
    title,
    steps,
  };
}

/** Resolves every outstanding plan exactly once; partial or duplicate decisions are invalid. */
export function reviewEntries(
  responses: PlanReviewResponse[],
  interrupts: Interrupt[],
): ResumeEntry[] | null {
  const expected = new Set(interrupts.map((item) => item.id));
  const received = new Set(responses.map((item) => item.interruptId));

  const incompleteResponseSet =
    !expected.size ||
    responses.length !== expected.size ||
    received.size !== expected.size ||
    responses.some((response) => !expected.has(response.interruptId));

  if (incompleteResponseSet) {
    return null;
  }

  return responses.map(({ interruptId, decision, title, steps }) => ({
    interruptId,
    status: "resolved",
    payload: { decision, title, steps },
  }));
}
