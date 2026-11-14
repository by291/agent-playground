import type { ConversationState } from "./state";
import { parseExternalWait } from "@shared/external-task";
import { parseWorkflowReview } from "@shared/workflow-review";
import { isRunFinished } from "@shared/run-status";
import { parseAgentInteraction } from "@shared/agent-interaction";

/** Keeps interaction controls in the running state during live execution and recovery. */
export function isRunning(state: ConversationState) {
  return state.lifecycle.execution !== "idle";
}

/** Identifies a conversation waiting for its first persisted snapshot. */
export function isRestoring(state: ConversationState) {
  return state.lifecycle.hydration === "restoring";
}

/** Determines whether the workspace can display the new-conversation view. */
export function isEmpty(state: ConversationState) {
  return (
    state.lifecycle.emptyHint &&
    state.messages.length === 0 &&
    state.surfaces.length === 0 &&
    state.pendingInterrupts.length === 0
  );
}

/** Allows model changes only while the conversation has no blocking work. */
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

/** Selects the issue currently presented by the conversation timeline. */
export function conversationIssue(state: ConversationState) {
  return state.issues.snapshot ?? state.issues.output ?? state.issues.run;
}

/** Projects session state into the controls needed by the message composer. */
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
