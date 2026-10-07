import { z } from "zod";

export const agentInfoSchema = z.object({
  model: z.string().trim().min(1),
  defaultModelId: z.enum(["deepseek", "qwen"]).optional(),
  models: z
    .object({
      id: z.enum(["deepseek", "qwen"]),
      label: z.string().trim().min(1),
      model: z.string().trim().min(1),
      available: z.boolean(),
    })
    .array()
    .optional(),
});

export type AgentInfo = z.infer<typeof agentInfoSchema>;
