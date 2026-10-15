import type { ConversationState } from "./state";
import { parseExternalWait } from "@shared/external-task";
import { parseWorkflowReview } from "@shared/workflow-review";
import { isRunFinished } from "@shared/run-status";
import { parseAgentInteraction } from "@shared/agent-interaction";

export function isRunning(state: ConversationState) {
  return state.lifecycle.execution !== "idle";
}

export function isRestoring(state: ConversationState) {
  return state.lifecycle.hydration === "restoring";
}

export function isEmpty(state: ConversationState) {
  return (
    state.lifecycle.emptyHint &&
    state.messages.length === 0 &&
    state.surfaces.length === 0 &&
    state.pendingInterrupts.length === 0
  );
}

export function canSelectModel(state: ConversationState) {
  const latest = state.runs.at(-1);
  const unfinishedRun =
    latest && latest.status !== "completed" && latest.status !== "failed";
  const unfinishedExternalTask = state.externalTasks.some(
    (task) =>
      task.status === "queued" ||
      task.status === "running" ||
      task.status === "input_required" ||
      !task.continuationStatus ||
      !isRunFinished(task.continuationStatus),
  );

  return (
    !isRestoring(state) &&
    !isRunning(state) &&
    !state.modelSwitching &&
    state.pendingInterrupts.length === 0 &&
    !unfinishedRun &&
    !unfinishedExternalTask
  );
}

export function conversationIssue(state: ConversationState) {
  return state.issues.snapshot ?? state.issues.output ?? state.issues.run;
}

export function composerState(state: ConversationState) {
  const workflowReview =
    state.pendingInterrupts.length === 1
      ? parseWorkflowReview(state.pendingInterrupts[0]!)
      : null;

  const waitingForExternalTask = state.pendingInterrupts.some(
    (interrupt) => parseExternalWait(interrupt) !== null,
  );

  return {
    waitingForInteraction: state.pendingInterrupts.some(
      (interrupt) => parseAgentInteraction(interrupt) !== null,
    ),
    waitingForExternalTask,
    running: isRunning(state),
    recovering: isRestoring(state),
    changingModel: state.modelSwitching,
    waitingForReview:
      state.pendingInterrupts.some(
        (interrupt) => !parseExternalWait(interrupt),
      ) && !workflowReview,
    discussionPlaceholder: workflowReview?.messagePlaceholder ?? null,
    onSend: state.send,
  };
}
