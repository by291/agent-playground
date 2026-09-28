import {
  EventType,
  HttpAgent,
  type Interrupt,
  type Message,
} from "@ag-ui/client";
import { createStore } from "zustand/vanilla";
import { parseA2UIEvent, type A2UIOutput } from "../a2ui/outputs";
import { createA2UIRuntime, type A2UISurfaceView } from "../a2ui/runtime";
import { reviewEntries, type PlanReviewResponse } from "./planReview";
import { reconcileSnapshot, pendingRecovery } from "./reconciliation";
import { saveConversation, type SavedConversation } from "./storage";
import type { ConversationSnapshot, PendingSubmission } from "./contracts";
import type { Activity } from "./types";
import { createSubmissionRunner } from "./submission";
import {
  parseContextUsage,
  type ContextUsage,
} from "../../../shared/context-usage";

export interface ConversationState {
  contextUsage: ContextUsage | null;
  messages: Message[];
  surfaces: A2UISurfaceView[];
  a2uiIssue: string | null;
  activity: Activity[];
  pendingInterrupts: Interrupt[];
  running: boolean;
  recovering: boolean;
  animatedMessageId: string | null;
  recoveryIssue: string | null;
  snapshotIssue: string | null;
  send: (content: string) => Promise<void>;
  reviewPlan: (responses: PlanReviewResponse[]) => Promise<void>;
}

// Query ownership stays outside the session; a refresh requests a new result.
type RefreshSnapshot = () => Promise<void>;

export function createConversationSession(
  saved: SavedConversation,
  agent = new HttpAgent({ url: "/agent", threadId: saved.threadId }),
) {
  agent.use((input, next) => {
    const state = { ...input.state } as Record<string, unknown>;
    const userMessage = [...input.messages]
      .reverse()
      .find((message) => message.role === "user");
    let messages: Message[] = [];

    if (!input.resume?.length && userMessage) {
      messages = [userMessage];
    }

    // Model history and reporting fields belong to the server's checkpoint.
    delete state.messages;
    delete state.context_usage;
    delete state.response_messages;

    return next.run({ ...input, messages, state });
  });

  let connected = false;
  let pending = saved.pending;
  let submittedRunId: string | undefined;
  let streamInterrupts: Interrupt[] | undefined;
  let refresh: RefreshSnapshot;
  let a2ui: ReturnType<typeof createA2UIRuntime> | undefined;
  let invalidOutputIssue: string | null = null;
  let recoveringOutputs = false;

  const store = createStore<ConversationState>()(() => ({
    contextUsage: null,
    messages: [],
    surfaces: [],
    a2uiIssue: null,
    activity: [],
    pendingInterrupts: [],
    running: false,
    recovering: true,
    animatedMessageId: null,
    recoveryIssue: null,
    snapshotIssue: null,
    send,
    reviewPlan,
  }));
  const submission = createSubmissionRunner(saved.threadId, agent, {
    started() {
      streamInterrupts = undefined;
      store.setState({
        messages: [...agent.messages],
        running: true,
        recoveryIssue: null,
      });
    },

    failed(error) {
      if (connected) {
        store.setState({
          recoveryIssue: errorDetail(error, "Agent run failed"),
        });
      }
    },

    async settled() {
      streamInterrupts = undefined;

      if (connected) {
        await requestSnapshot();
      }
    },
  });

  function receiveOutputs(outputs: A2UIOutput[]) {
    const result = a2ui?.ingest(outputs);

    if (!result) {
      return false;
    }

    let issue: string | null = null;

    if (result.kind === "failed") {
      issue = result.error;
    } else if (result.kind === "waiting") {
      issue = `Waiting for A2UI output ${result.missingOutputSeq} to recover.`;
    }

    if (result.kind === "failed" && issue !== store.getState().a2uiIssue) {
      submission.trace?.error(new Error(result.error));
    }

    store.setState({
      surfaces: result.surfaces,
      a2uiIssue: invalidOutputIssue ?? issue,
    });

    return result.kind === "waiting";
  }

  function clearPending() {
    pending = undefined;
    saveConversation({ threadId: saved.threadId });
  }

  function receiveContextUsage(value: unknown) {
    const usage = parseContextUsage(value);
    const current = store.getState().contextUsage;

    if (usage && (!current || usage.revision >= current.revision)) {
      store.setState({ contextUsage: usage });
    }
  }

  function receiveSnapshot(snapshot: ConversationSnapshot | null) {
    if (!connected) {
      return;
    }

    const initialPending = store.getState().recovering ? pending : undefined;

    store.setState({ recovering: false, snapshotIssue: null });

    const result = reconcileSnapshot(snapshot, {
      submittedRunId,
      submitting: submission.active,
      streaming: agent.isRunning,
      messages: agent.messages,
      interrupts: streamInterrupts,
    });

    if (result.kind === "current") {
      receiveContextUsage(snapshot?.contextUsage);
      agent.setMessages(result.messages);
      store.setState({
        messages: [...agent.messages],
        pendingInterrupts: result.interrupts,
        running: result.running,
        recoveryIssue: result.issue,
      });

      if (result.canonical) {
        submittedRunId = undefined;
      }
    } else if (!submission.active && !agent.isRunning) {
      // Rejected requests may never enter server history. Keep their input and error.
      store.setState({ running: result.running });
    }

    receiveOutputs(snapshot?.outputs ?? []);

    if (pending && pendingRecovery(snapshot, pending) === "confirmed") {
      clearPending();
    }

    if (
      initialPending &&
      pendingRecovery(snapshot, initialPending) === "retry"
    ) {
      // Only an unconfirmed admission is retried with its original run ID and input.
      void runSubmission(initialPending);
    }
  }

  function receiveSnapshotError(error: unknown) {
    if (!connected) {
      return;
    }

    submission.trace?.event("snapshot_recovery_failed");
    store.setState({ snapshotIssue: errorDetail(error, "Recovery failed") });
  }

  async function requestSnapshot() {
    try {
      await refresh();
    } catch {
      // The query owner delivers errors through receiveSnapshotError.
    }
  }

  async function recoverOutputGap() {
    if (recoveringOutputs) {
      return;
    }

    recoveringOutputs = true;

    try {
      await requestSnapshot();
    } finally {
      recoveringOutputs = false;
    }
  }

  function runSubmission(input: PendingSubmission) {
    if (!connected || submission.active) {
      return Promise.resolve();
    }

    submittedRunId = input.runId;

    return submission.run(input);
  }

  function submit(input: PendingSubmission) {
    // Save before sending so a reload can retry exactly the same admission.
    saveConversation({ threadId: saved.threadId, pending: input });
    pending = input;

    return runSubmission(input);
  }

  function busy() {
    const state = store.getState();

    return !connected || state.recovering || state.running;
  }

  function send(content: string): Promise<void> {
    const text = content.trim();

    if (!text || busy() || store.getState().pendingInterrupts.length) {
      return Promise.resolve();
    }

    const message: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
    };

    return submit({
      runId: crypto.randomUUID(),
      messageId: message.id,
      messages: [...agent.messages, message],
      state: structuredClone(agent.state as Record<string, unknown>),
    });
  }

  function reviewPlan(responses: PlanReviewResponse[]): Promise<void> {
    if (busy()) {
      return Promise.resolve();
    }

    const resume = reviewEntries(responses, store.getState().pendingInterrupts);

    if (!resume) {
      return Promise.resolve();
    }

    const runId = crypto.randomUUID();

    return submit({
      runId,
      messageId: runId,
      messages: [...agent.messages],
      state: structuredClone(agent.state as Record<string, unknown>),
      resume,
    });
  }

  function connect(requestRefresh: RefreshSnapshot) {
    connected = true;
    refresh = requestRefresh;
    a2ui = createA2UIRuntime();
    invalidOutputIssue = null;
    store.setState({ surfaces: [], a2uiIssue: null });

    const subscription = agent.subscribe({
      onEvent({ event }) {
        if (!connected) {
          return;
        }

        if (
          event.type === EventType.TEXT_MESSAGE_CONTENT &&
          typeof event.delta === "string" &&
          event.delta.length &&
          typeof event.messageId === "string"
        ) {
          submission.trace?.firstText();
          store.setState({ animatedMessageId: event.messageId });
        }

        try {
          const output = parseA2UIEvent(event);

          if (output && receiveOutputs([output])) {
            void recoverOutputGap();
          }
        } catch (error) {
          submission.trace?.error(error);
          invalidOutputIssue = errorDetail(error, "Invalid A2UI output");
          store.setState({ a2uiIssue: invalidOutputIssue });
        }

        if (event.type === EventType.RUN_ERROR) {
          submission.trace?.error(new Error(String(event.message)));
        }

        if (
          event.type === EventType.RAW ||
          event.type === EventType.STATE_SNAPSHOT
        ) {
          return;
        }

        const detail = "name" in event ? String(event.name) : undefined;

        store.setState((state) => ({
          activity: [
            {
              id: crypto.randomUUID(),
              type: event.type,
              ...(detail ? { detail } : {}),
            },
            ...state.activity,
          ].slice(0, 30),
        }));
      },

      onMessagesChanged() {
        if (connected) {
          store.setState({ messages: [...agent.messages] });
        }
      },

      onStateChanged({ state }) {
        if (
          connected &&
          state &&
          typeof state === "object" &&
          "context_usage" in state
        ) {
          receiveContextUsage(state.context_usage);
        }
      },

      onRunFinishedEvent({ event }) {
        submission.trace?.outcome(
          event.outcome?.type === "interrupt" ? "interrupted" : "finished",
        );

        if (!connected) {
          return;
        }

        streamInterrupts =
          event.outcome?.type === "interrupt" ? event.outcome.interrupts : [];
        store.setState({ pendingInterrupts: streamInterrupts });
      },
    });

    return () => {
      connected = false;
      submission.trace?.outcome("disconnected");
      subscription.unsubscribe();
      a2ui?.dispose();
      a2ui = undefined;
      // Detach the browser stream; the server-owned Aegra run continues.
      void agent.detachActiveRun();
    };
  }

  return { store, connect, receiveSnapshot, receiveSnapshotError };
}

function errorDetail(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
