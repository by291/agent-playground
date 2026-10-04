import { z } from "zod";

export const workflowReviewSchema = z.object({
  kind: z.literal("workflow_review"),
  workflowCallId: z.string().min(1),
  revision: z.number().int().positive(),
  round: z.number().int().positive(),
  outputStepId: z.string().min(1),
  canAccept: z.boolean(),
  title: z.string().min(1).default("Workflow decision"),
  acceptLabel: z.string().min(1).default("Accept"),
  messagePlaceholder: z
    .string()
    .min(1)
    .default("Ask a question or describe a change…"),
  blockedReason: z.string().optional(),
});

const identity = {
  workflowCallId: z.string().min(1),
  revision: z.number().int().positive(),
  round: z.number().int().positive(),
};

export const workflowReviewResponseSchema = z.discriminatedUnion("action", [
  z
    .object({
      ...identity,
      action: z.literal("message"),
      message: z.string().trim().min(1).max(10000),
      messageId: z.string().min(1),
    })
    .strict(),
  z.object({ ...identity, action: z.literal("accept") }).strict(),
  z.object({ ...identity, action: z.literal("abandon") }).strict(),
]);

export type WorkflowReviewResponse = z.infer<
  typeof workflowReviewResponseSchema
>;
export type WorkflowReview = z.infer<typeof workflowReviewSchema> & {
  interruptId: string;
};

export function parseWorkflowReview(interrupt: {
  id: string;
  metadata?: unknown;
}): WorkflowReview | null {
  const metadata = z
    .object({ langgraph: z.object({ raw: z.unknown() }) })
    .safeParse(interrupt.metadata);

  if (!metadata.success) {
    return null;
  }

  const raw = metadata.data.langgraph.raw;
  const parsed = workflowReviewSchema.safeParse(raw);
  return parsed.success ? { ...parsed.data, interruptId: interrupt.id } : null;
}

export function reviewResponse(
  review: WorkflowReview,
  action: "accept" | "abandon" | "message",
  message?: { id: string; content: string },
) {
  if (action === "accept" && !review.canAccept) {
    return null;
  }

  const parsed = workflowReviewResponseSchema.safeParse({
    action,
    workflowCallId: review.workflowCallId,
    revision: review.revision,
    round: review.round,
    ...(action === "message"
      ? { message: message?.content, messageId: message?.id }
      : {}),
  });

  return parsed.success
    ? {
        interruptId: review.interruptId,
        status: "resolved" as const,
        payload: parsed.data,
      }
    : null;
}
