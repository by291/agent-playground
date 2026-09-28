import {
  EventType,
  HttpAgent,
  type Interrupt,
  type Message,
  type ResumeEntry,
} from "@ag-ui/client";
import { createStore } from "zustand/vanilla";
import { parseA2UIEvent, type A2UIOutput } from "../a2ui/outputs";
import { createA2UIRuntime, type A2UISurfaceView } from "../a2ui/runtime";
import type { PlanReviewResponse } from "./planReview";
import { mergeMessages, type ConversationSnapshot } from "./snapshot";
import {
  saveConversation,
  type PendingSubmission,
  type SavedConversation,
} from "./storage";
import type { Activity } from "./types";

export interface ConversationState {
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

type RefreshSnapshot = () => Promise<ConversationSnapshot | null>;

export function createConversationSession(
  saved: SavedConversation,
  agent = new HttpAgent({ url: "/agent", threadId: saved.threadId }),
) {
  let connected = false;
  let submitting = false;
  let pending = saved.pending;
  let submittedRunId: string | undefined;
  let streamInterrupts: Interrupt[] | undefined;
  let refresh: RefreshSnapshot;
  let a2ui: ReturnType<typeof createA2UIRuntime> | undefined;
  let invalidOutputIssue: string | null = null;
  let fillingOutputGap = false;
  const store = createStore<ConversationState>()(() => ({
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

  function receiveOutputs(outputs: A2UIOutput[]) {
    const result = a2ui?.ingest(outputs);
    if (!result) return false;
    store.setState({
      surfaces: result.surfaces,
      a2uiIssue: invalidOutputIssue ?? result.issue,
    });
    return result.needsRecovery;
  }

  function clearPending() {
    pending = undefined;
    saveConversation({ threadId: saved.threadId });
  }

  function applySnapshot(snapshot: ConversationSnapshot | null) {
    if (!connected) return;
    const pendingRecovery = store.getState().recovering ? pending : undefined;
    store.setState({ recovering: false, snapshotIssue: null });
    const latest = snapshot?.runs.at(-1);
    const serverRunning =
      latest?.status === "prepared" ||
      latest?.status === "dispatching" ||
      latest?.status === "running";

    // A request started before this submission can return the previous run.
    // It must not replace the new stream or unlock its composer.
    if (!submittedRunId || latest?.runId === submittedRunId) {
      const finished =
        latest?.status === "completed" ||
        latest?.status === "failed" ||
        latest?.status === "interrupted";
      const canonical = finished && !submitting && !agent.isRunning;
      if (snapshot && !submitting && !agent.isRunning) {
        // Preserve a disconnected preview until the final checkpoint replaces its IDs.
        agent.setMessages(
          canonical
            ? snapshot.messages
            : mergeMessages(snapshot.messages, agent.messages),
        );
      }
      store.setState({
        messages: [...agent.messages],
        pendingInterrupts: streamInterrupts ?? snapshot?.interrupts ?? [],
        running: submitting || agent.isRunning || serverRunning,
        recoveryIssue:
          latest?.status === "submission_unknown"
            ? "Submission status is unknown. Review the server state before retrying."
            : latest?.status === "failed"
              ? "The agent run failed. Saved cards remain available."
              : null,
      });
      if (canonical) submittedRunId = undefined;
    } else if (!submitting && !agent.isRunning) {
      // A rejected request may never appear in server history. Keep its input and error.
      store.setState({ running: serverRunning });
    }
    receiveOutputs(snapshot?.outputs ?? []);

    const savedRun = snapshot?.runs.find((run) => run.runId === pending?.runId);
    if (savedRun && savedRun.status !== "prepared") clearPending();
    if (pendingRecovery && (!savedRun || savedRun.status === "prepared")) {
      // A reload resends the original input and run ID only while admission is unconfirmed.
      void runSubmission(pendingRecovery);
    }
  }

  async function refreshSnapshot() {
    try {
      applySnapshot(await refresh());
    } catch (error) {
      if (connected)
        store.setState({
          snapshotIssue: errorDetail(error, "Recovery failed"),
        });
    }
  }

  async function recoverOutputGap() {
    if (fillingOutputGap) return;
    fillingOutputGap = true;
    try {
      await refreshSnapshot();
    } finally {
      fillingOutputGap = false;
    }
  }

  async function runSubmission(submission: PendingSubmission) {
    if (!connected || submitting) return;
    submitting = true;
    submittedRunId = submission.runId;
    streamInterrupts = undefined;
    agent.setMessages(submission.messages);
    agent.setState(submission.state);
    store.setState({
      messages: [...agent.messages],
      running: true,
      recoveryIssue: null,
    });
    try {
      await agent.runAgent({
        runId: submission.runId,
        ...(submission.resume ? { resume: submission.resume } : {}),
      });
    } catch (error) {
      if (connected)
        store.setState({
          recoveryIssue: errorDetail(error, "Agent run failed"),
        });
    } finally {
      submitting = false;
      streamInterrupts = undefined;
      if (connected) await refreshSnapshot();
    }
  }

  function submit(submission: PendingSubmission) {
    // Persist before sending so a reload can retry exactly the same admission.
    saveConversation({ threadId: saved.threadId, pending: submission });
    pending = submission;
    return runSubmission(submission);
  }

  function busy() {
    const state = store.getState();
    return (
      !connected ||
      state.recovering ||
      state.running ||
      submitting ||
      agent.isRunning
    );
  }

  function send(content: string): Promise<void> {
    const text = content.trim();
    if (!text || busy() || store.getState().pendingInterrupts.length)
      return Promise.resolve();
    const message: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
    };
    return submit({
      runId: crypto.randomUUID(),
      messageId: message.id,
      messages: [...agent.messages, message],
      state: structuredClone<Record<string, unknown>>(
        agent.state as Record<string, unknown>,
      ),
      userMessage: message,
    });
  }

  function reviewPlan(responses: PlanReviewResponse[]): Promise<void> {
    if (busy()) return Promise.resolve();
    const expected = new Set(
      store.getState().pendingInterrupts.map((item) => item.id),
    );
    const received = new Set(responses.map((item) => item.interruptId));
    if (
      !expected.size ||
      expected.size !== responses.length ||
      received.size !== expected.size ||
      responses.some((item) => !expected.has(item.interruptId))
    )
      return Promise.resolve();
    const resume: ResumeEntry[] = responses.map(
      ({ interruptId, decision, title, steps }) => ({
        interruptId,
        status: "resolved",
        payload: { decision, title, steps },
      }),
    );
    const runId = crypto.randomUUID();
    return submit({
      runId,
      messageId: runId,
      messages: [...agent.messages],
      state: structuredClone<Record<string, unknown>>(
        agent.state as Record<string, unknown>,
      ),
      resume,
    });
  }

  function connect(refreshSnapshot: RefreshSnapshot) {
    connected = true;
    refresh = refreshSnapshot;
    a2ui = createA2UIRuntime();
    invalidOutputIssue = null;
    store.setState({ surfaces: [], a2uiIssue: null });
    const subscription = agent.subscribe({
      onEvent({ event }) {
        if (!connected) return;
        if (
          event.type === EventType.TEXT_MESSAGE_CONTENT &&
          typeof event.messageId === "string"
        ) {
          store.setState({ animatedMessageId: event.messageId });
        }
        try {
          const output = parseA2UIEvent(event);
          if (output && receiveOutputs([output])) void recoverOutputGap();
        } catch (error) {
          invalidOutputIssue = errorDetail(error, "Invalid A2UI output");
          store.setState({ a2uiIssue: invalidOutputIssue });
        }
        if (
          event.type === EventType.RAW ||
          event.type === EventType.STATE_SNAPSHOT
        )
          return;
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
        if (connected) store.setState({ messages: [...agent.messages] });
      },
      onRunFinishedEvent({ event }) {
        if (!connected) return;
        streamInterrupts =
          event.outcome?.type === "interrupt" ? event.outcome.interrupts : [];
        store.setState({ pendingInterrupts: streamInterrupts });
      },
    });
    return () => {
      connected = false;
      subscription.unsubscribe();
      a2ui?.dispose();
      a2ui = undefined;
      // Detach the browser stream; the server-owned Aegra run continues.
      void agent.detachActiveRun();
    };
  }

  return { store, connect, applySnapshot };
}

function errorDetail(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
