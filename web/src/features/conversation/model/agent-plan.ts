import { z } from "zod";
import type { toolProcess } from "./turns";

// Validate the official Python write_todos tool arguments at the UI boundary.
const planSchema = z.object({
  todos: z.array(
    z.object({
      content: z.string().refine((content) => content.trim().length > 0),
      status: z.enum(
        /* prettier-ignore */ [
          "pending",
          "in_progress",
          "completed",
        ],
      ),
    }),
  ),
});

export type AgentPlanStep = z.infer<typeof planSchema>["todos"][number];

function readCommittedPlan(
  step: ReturnType<typeof toolProcess>[number]["calls"][number],
): AgentPlanStep[] | null {
  const isCommittedPlan =
    step.call.function.name === "write_todos" &&
    step.status === "completed" &&
    step.result &&
    !step.result.error;

  if (!isCommittedPlan) {
    return null;
  }

  try {
    const parsed = planSchema.safeParse(
      JSON.parse(step.call.function.arguments),
    );

    return parsed.success ? parsed.data.todos : null;
  } catch {
    // A partial update cannot replace the last committed plan.
    return null;
  }
}

/** Reads committed tool updates, so streams and archived turns share one projection. */
export function latestAgentPlan(
  toolGroups: ReturnType<typeof toolProcess>,
): AgentPlanStep[] | null {
  let plan: AgentPlanStep[] | null = null;

  for (const entry of toolGroups) {
    for (const step of entry.calls) {
      // An empty successful update clears the earlier plan in this turn.
      plan = readCommittedPlan(step) ?? plan;
    }
  }

  return plan;
}
