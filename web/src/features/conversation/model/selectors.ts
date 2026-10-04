import type { ConversationState } from "./state";
import { parseExternalWait } from "@shared/external-task";
import { parseWorkflowReview } from "@shared/workflow-review";

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
    waitingForExternalTask,
    running: isRunning(state),
    recovering: isRestoring(state),
    waitingForReview:
      state.pendingInterrupts.some(
        (interrupt) => !parseExternalWait(interrupt),
      ) && !workflowReview,
    discussionPlaceholder: workflowReview?.messagePlaceholder ?? null,
    onSend: state.send,
  };
}
