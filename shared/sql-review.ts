import { z } from "zod";

export const sqlCheckSchema = z.object({
  passed: z.boolean(),
  issues: z.array(z.string()),
});

export const sqlCardSchema = z.object({
  workflowCallId: z.string().min(1),
  sql: z.string().min(1),
  originalSql: z.string(),
  revision: z.number().int().positive(),
  round: z.number().int().positive(),
  status: z.enum(["review", "submitted", "abandoned"]),
  check: sqlCheckSchema,
  receiptId: z.string().optional(),
  replyId: z.string().optional(),
  reply: z.string().optional(),
});

export const sqlReviewSchema = sqlCardSchema
  .omit({ status: true, receiptId: true, replyId: true, reply: true })
  .extend({ kind: z.literal("sql_review"), outputStepId: z.string().min(1) });

const identity = {
  workflowCallId: z.string().min(1),
  revision: z.number().int().positive(),
  round: z.number().int().positive(),
};

export const sqlReviewResponseSchema = z.discriminatedUnion("action", [
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

export type SqlCard = z.infer<typeof sqlCardSchema>;
export type SqlReviewResponse = z.infer<typeof sqlReviewResponseSchema>;
export type SqlReview = z.infer<typeof sqlReviewSchema> & {
  interruptId: string;
};

export function parseSqlReview(interrupt: {
  id: string;
  metadata?: unknown;
}): SqlReview | null {
  const parsed = z
    .object({ langgraph: z.object({ raw: sqlReviewSchema }) })
    .safeParse(interrupt.metadata);

  return parsed.success
    ? { ...parsed.data.langgraph.raw, interruptId: interrupt.id }
    : null;
}

export function sqlResponse(
  review: SqlReview,
  action: "accept" | "abandon" | "message",
  message?: { id: string; content: string },
) {
  if (action === "accept" && !review.check.passed) {
    return null;
  }

  const parsed = sqlReviewResponseSchema.safeParse({
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

export function sqlCards(value: unknown): SqlCard[] {
  const parsed = z.object({ messages: z.array(z.unknown()) }).safeParse(value);

  if (!parsed.success) {
    return [];
  }

  return parsed.data.messages.flatMap((message) => {
    const update = z
      .object({
        updateComponents: z.object({ components: z.array(z.unknown()) }),
      })
      .safeParse(message);

    if (!update.success) {
      return [];
    }

    return update.data.updateComponents.components.flatMap((component) => {
      const card = sqlCardSchema
        .extend({ component: z.literal("WorkflowSql") })
        .safeParse(component);

      return card.success ? [card.data] : [];
    });
  });
}

export function sqlReplyMessages(value: unknown) {
  return sqlCards(value).flatMap((card) =>
    card.replyId && card.reply
      ? [{ id: card.replyId, role: "assistant" as const, content: card.reply }]
      : [],
  );
}
