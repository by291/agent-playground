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
});

export type SqlCard = z.infer<typeof sqlCardSchema>;
