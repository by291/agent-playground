import { z } from "zod";

export const agentInfoSchema = z.object({
  model: z.string().trim().min(1),
});

export type AgentInfo = z.infer<typeof agentInfoSchema>;
