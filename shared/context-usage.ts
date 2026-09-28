import { z } from "zod";

const tokens = z.number().int().nonnegative();

export const contextUsageSchema = z.object({
  model: z.string().min(1),
  usedTokens: tokens,
  contextWindow: z.number().int().positive(),
  triggerTokens: z.number().int().positive(),
  breakdown: z.object({
    system: tokens,
    tools: tokens,
    conversation: tokens,
    toolResults: tokens,
    summary: tokens,
  }),
  lastInputTokens: tokens.nullable(),
  compactions: tokens,
  lastCompaction: z
    .object({ beforeTokens: tokens, afterTokens: tokens })
    .nullable(),
  revision: z.number().int().positive(),
});

export type ContextUsage = z.infer<typeof contextUsageSchema>;

export function parseContextUsage(value: unknown): ContextUsage | null {
  const parsed = contextUsageSchema.safeParse(value);

  return parsed.success ? parsed.data : null;
}
