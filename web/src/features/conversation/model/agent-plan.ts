import { z } from "zod";
import type { toolProcess } from "./turns";

// Validate the official Python write_todos tool arguments at the UI boundary.
const planSchema = z.object({
  todos: z.array(
    z.object({
      content: z.string().refine((content) => content.trim().length > 0),
      status: z.enum(["pending", "in_progress", "completed"]),
    }),
  ),
});

export type AgentPlanStep = z.infer<typeof planSchema>["todos"][number];

/** Reads committed tool updates, so streams and archived turns share one projection. */
export function latestAgentPlan(
  process: ReturnType<typeof toolProcess>,
): AgentPlanStep[] | null {
  let plan: AgentPlanStep[] | null = null;

  for (const entry of process) {
    for (const step of entry.calls) {
      const committed =
        step.call.function.name === "write_todos" &&
        step.status === "completed" &&
        step.result &&
        !step.result.error;

      if (!committed) {
        continue;
      }

      try {
        const parsed = planSchema.safeParse(
          JSON.parse(step.call.function.arguments),
        );

        if (parsed.success) {
          // An empty successful update clears a previous plan in the same turn.
          plan = parsed.data.todos;
        }
      } catch {
        // Partially streamed or malformed arguments cannot replace a saved plan.
        continue;
      }
    }
  }

  return plan;
}
