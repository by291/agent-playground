import type { ConversationReference } from "./conversation-storage";

export interface ConversationLifecycle {
  hydration: "fresh" | "restoring" | "ready";
  execution:
    | "idle"
    | "submitting"
    | "streaming"
    | "awaiting-snapshot"
    | "recovering-run";
  synchronization: "deferred" | "on-demand" | "polling";
  emptyHint: boolean;
}

export type LifecycleEvent =
  | { type: "submission-started" }
  | { type: "stream-started" }
  | { type: "stream-settled" }
  | { type: "snapshot-failed"; locallyActive: boolean }
  | {
      type: "snapshot-received";
      locallyActive: boolean;
      running: boolean;
      needsRecovery: boolean;
      empty: boolean;
    };

export function initialLifecycle(
  saved: ConversationReference,
): ConversationLifecycle {
  const fresh = saved.fresh === true && !saved.pending;

  return {
    hydration: fresh ? "fresh" : "restoring",
    execution: "idle",
    synchronization: fresh ? "deferred" : "on-demand",
    emptyHint: saved.empty === true && !saved.pending,
  };
}

export function transitionLifecycle(
  state: ConversationLifecycle,
  event: LifecycleEvent,
): ConversationLifecycle {
  switch (event.type) {
    case "submission-started":
      return {
        ...state,
        hydration: "ready",
        execution: "submitting",
        synchronization:
          state.synchronization === "deferred" ? "deferred" : "on-demand",
        emptyHint: false,
      };
    case "stream-started":
      return { ...state, execution: "streaming" };
    case "stream-settled":
      return {
        ...state,
        execution: "awaiting-snapshot",
        synchronization: "polling",
      };
    case "snapshot-failed":
      return {
        ...state,
        synchronization: event.locallyActive
          ? activeSynchronization(state)
          : "polling",
      };
    case "snapshot-received": {
      let execution = state.execution;
      let synchronization = activeSynchronization(state);

      if (!event.locallyActive) {
        execution = event.running ? "recovering-run" : "idle";
        synchronization = event.needsRecovery ? "polling" : "on-demand";
      }

      return {
        hydration: "ready",
        execution,
        synchronization,
        emptyHint: event.empty,
      };
    }
  }
}

function activeSynchronization(
  state: ConversationLifecycle,
): ConversationLifecycle["synchronization"] {
  return state.synchronization === "deferred" ? "deferred" : "on-demand";
}

export function snapshotPolicy(state: ConversationLifecycle) {
  return {
    enabled: state.synchronization !== "deferred",
    polling: state.synchronization === "polling",
  };
}
