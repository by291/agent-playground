import type { ConversationReference } from "./conversation-storage";

/** Readiness, agent execution and Query scheduling are independent state axes. */
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

/** Defers snapshots for a fresh draft and restores saved threads before enabling input. */
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

/** Applies one conversation event to hydration, execution and synchronization. */
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
      // A closed HTTP stream still needs a checkpoint before recovery can stop.
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

      // Snapshot delivery cannot replace the execution state of a local stream.
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

/** Exposes the fetch and poll policy without coupling session state to Query. */
export function snapshotPolicy(state: ConversationLifecycle) {
  return {
    enabled: state.synchronization !== "deferred",
    polling: state.synchronization === "polling",
  };
}
