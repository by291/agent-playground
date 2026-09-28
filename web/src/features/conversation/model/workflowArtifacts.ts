import type { ToolCall } from "@ag-ui/client";
import type { A2UISurfaceView } from "@/features/a2ui";
import type { PlanReview } from "./planReview";

function experimentStage(view: A2UISurfaceView): string | null {
  const prefix = `experiment-${view.toolCallId}-`;

  if (!view.toolCallId || !view.surface.id.startsWith(prefix)) {
    return null;
  }

  const stage = view.surface.id.slice(prefix.length);

  return ["idea", "draft", "review", "reviewed"].includes(stage) ? stage : null;
}

export function workflowArtifacts(
  calls: readonly ToolCall[],
  surfaces: readonly A2UISurfaceView[],
  reviews: readonly PlanReview[],
) {
  const experimentCalls = new Set(
    calls
      .filter((call) => call.function.name === "run_experiment_workflow")
      .map((call) => call.id),
  );
  const current: A2UISurfaceView[] = [];
  const history: A2UISurfaceView[] = [];
  const positions = new Map<string, number>();

  // Stage surfaces remain durable protocol outputs. Show the latest stage in
  // place, including for conversations saved before this presentation existed.
  for (const view of surfaces) {
    if (
      !view.toolCallId ||
      !experimentCalls.has(view.toolCallId) ||
      !experimentStage(view)
    ) {
      current.push(view);
      continue;
    }

    const index = positions.get(view.toolCallId);

    if (index === undefined) {
      positions.set(view.toolCallId, current.length);
      current.push(view);
    } else {
      history.push(current[index]!);
      current[index] = view;
    }
  }

  const completed = new Set(
    current
      .filter((view) => experimentStage(view) === "reviewed")
      .map((view) => view.toolCallId),
  );
  const pending = reviews.filter(
    (review) => !review.workflowCallId || !completed.has(review.workflowCallId),
  );
  const owners = new Set(pending.map((review) => review.workflowCallId));
  const legacyReview = pending.some((review) => !review.workflowCallId);
  const visible = current.filter((view) => {
    const replacedByEditor =
      experimentStage(view) === "review" &&
      (legacyReview || owners.has(view.toolCallId));

    if (replacedByEditor) {
      history.push(view);
    }

    return !replacedByEditor;
  });

  return { current: visible, history, reviews: pending };
}
