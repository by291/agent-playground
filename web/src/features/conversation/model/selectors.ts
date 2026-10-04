import type { ConversationState } from "./state";
import { parseSqlReview } from "@shared/sql-review";

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
  const sqlReview =
    state.pendingInterrupts.length === 1
      ? parseSqlReview(state.pendingInterrupts[0]!)
      : null;

  return {
    running: isRunning(state),
    recovering: isRestoring(state),
    waitingForReview: state.pendingInterrupts.length > 0 && !sqlReview,
    discussingSql: sqlReview !== null,
    onSend: state.send,
  };
}
