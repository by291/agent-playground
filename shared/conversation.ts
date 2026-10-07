import { z } from "zod";
import { runStatuses } from "./run-status";

export const conversationTitleSchema = z
  .string()
  .trim()
  .min(1)
  .refine(
    (title) => Array.from(title).length <= 100,
    "Title must contain at most 100 characters",
  );
export const renameConversationSchema = z.object({
  title: conversationTitleSchema,
});

export const selectConversationModelSchema = z.object({
  modelId: z.string().trim().min(1).max(100),
});

export const conversationSummarySchema = z.object({
  threadId: z.string().min(1),
  title: conversationTitleSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  status: z.enum(runStatuses).nullable(),
});

export const conversationPageSchema = z.object({
  conversations: conversationSummarySchema.array(),
  nextCursor: z.string().nullable(),
});

export type ConversationSummary = z.infer<typeof conversationSummarySchema>;
export type ConversationPage = z.infer<typeof conversationPageSchema>;
