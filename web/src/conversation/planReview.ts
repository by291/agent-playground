import type { Interrupt } from "@ag-ui/client";

export interface PlanReview {
  interruptId: string;
  title: string;
  steps: string[];
}

export interface PlanReviewResponse extends PlanReview {
  decision: "approve" | "reject";
}

export function parsePlanReview(interrupt: Interrupt): PlanReview | null {
  const langgraph: unknown = interrupt.metadata?.langgraph;
  if (typeof langgraph !== "object" || langgraph === null) return null;
  const raw: unknown = "raw" in langgraph ? langgraph.raw : null;
  if (typeof raw !== "object" || raw === null) return null;
  if (!("kind" in raw) || raw.kind !== "experiment_plan_review") return null;
  if (!("title" in raw) || typeof raw.title !== "string") return null;
  if (!("steps" in raw) || !Array.isArray(raw.steps)) return null;
  if (!raw.steps.every((step) => typeof step === "string")) return null;

  return { interruptId: interrupt.id, title: raw.title, steps: raw.steps };
}
