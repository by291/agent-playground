import {
  configureConversationAgent,
  subscribeConversationAgent,
} from "./agent";
import {
  EventType,
  HttpAgent,
  type Interrupt,
  type Message,
} from "@ag-ui/client";
import { createStore } from "zustand/vanilla";
import { parseA2UIEvent, type A2UIOutput } from "@/features/a2ui";
import { createA2UIRuntime } from "@/features/a2ui";
import { reviewEntries, type PlanReviewResponse } from "../model/planReview";
import { reconcileSnapshot, pendingRecovery } from "../model/reconciliation";
import { saveConversation, type ConversationReference } from "../model/storage";
import type { ConversationSnapshot, PendingSubmission } from "../api/contracts";
import type { ConversationState } from "../model/state";
import {
  initialLifecycle,
  transitionLifecycle,
  type LifecycleEvent,
} from "../model/lifecycle";
import { isRunning, isRestoring } from "../model/selectors";
import { createSubmissionRunner } from "./submission";
import { isRunFinished } from "@shared/run-status";
import { parseContextUsage } from "@shared/context-usage";

// Query ownership stays outside the session; a refresh requests a new result.
type RefreshSnapshot = () => Promise<void>;

export function createConversationSession(
  saved: ConversationReference,
  agent = new HttpAgent({ url: "/agent", threadId: saved.threadId }),
) {
  configureConversationAgent(agent);

  let connected = false;
  let pending = saved.pending;
  let savedEmpty = saved.empty;
  let submittedRunId: string | undefined;
  let awaitingCheckpoint = false;
  let streamInterrupts: Interrupt[] | undefined;
  let refresh: RefreshSnapshot;
  let a2ui: ReturnType<typeof createA2UIRuntime> | undefined;
  let invalidOutputIssue: string | null = null;
  let recoveringOutputs = false;

  const store = createStore<ConversationState>()(() => ({
    contextUsage: null,
    runs: [],
    messages: [],
    surfaces: [],
    activity: [],
    pendingInterrupts: [],
    lifecycle: initialLifecycle(saved),
    animatedMessageId: null,
    issues: { run: null, snapshot: null, output: null },
    send,
    reviewPlan,
  }));
  const submission = createSubmissionRunner(saved.threadId, agent, {
    started() {
      streamInterrupts = undefined;
      awaitingCheckpoint = false;
      const runs = store
        .getState()
        .runs.filter((run) => run.runId !== submittedRunId);

      if (pending) {
        runs.push({
          runId: pending.runId,
          messageId: pending.messageId,
          status: "running",
        });
      }

      store.setState({
        runs,
        messages: [...agent.messages],
        lifecycle: transitionLifecycle(store.getState().lifecycle, {
          type: "submission-started",
        }),
        issues: { ...store.getState().issues, run: null },
      });
    },

    failed(error) {
      if (connected) {
        updateRunStatus("failed");
        setIssue("run", errorDetail(error, "Agent run failed"));
      }
    },

    async settled() {
      streamInterrupts = undefined;

      if (connected) {
        updateLifecycle({ type: "stream-settled" });
        await requestSnapshot();
      }
    },
  });

  function updateLifecycle(event: LifecycleEvent) {
    store.setState((state) => ({
      lifecycle: transitionLifecycle(state.lifecycle, event),
    }));
  }

  function setIssue(
    kind: keyof ConversationState["issues"],
    issue: string | null,
  ) {
    store.setState((state) => ({ issues: { ...state.issues, [kind]: issue } }));
  }

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

    if (result.kind === "failed" && issue !== store.getState().issues.output) {
      submission.trace?.error(new Error(result.error));
    }

    store.setState({
      surfaces: result.surfaces,
      issues: {
        ...store.getState().issues,
        output: invalidOutputIssue ?? issue,
      },
    });

    return result.kind === "waiting";
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

    const initialPending = isRestoring(store.getState()) ? pending : undefined;

    const result = reconcileSnapshot(snapshot, {
      submittedRunId,
      submitting: submission.active,
      streaming: agent.isRunning,
      messages: agent.messages,
      interrupts: streamInterrupts,
    });

    if (result.kind === "current") {
      const localRun = store
        .getState()
        .runs.find((run) => run.runId === submittedRunId);
      const runs = (snapshot?.runs ?? []).map((run) => {
        if (
          run.runId === localRun?.runId &&
          isRunFinished(localRun.status) &&
          !isRunFinished(run.status)
        ) {
          return { ...run, status: localRun.status };
        }

        return run;
      });

      receiveContextUsage(snapshot?.contextUsage);
      agent.setMessages(result.messages);
      store.setState({
        title: snapshot?.title,
        messages: [...agent.messages],
        pendingInterrupts: result.interrupts,
        runs,
        issues: { ...store.getState().issues, run: result.issue },
      });

      if (result.canonical) {
        submittedRunId = undefined;
        awaitingCheckpoint = false;
      }
    }

    const waitingForOutputs = receiveOutputs(snapshot?.outputs ?? []);
    const waitingForRun =
      result.running ||
      snapshot?.runs.at(-1)?.status === "submission_unknown" ||
      (result.kind === "stale" && awaitingCheckpoint);
    const locallyActive = submission.active || agent.isRunning;

    const pendingConfirmed =
      pending && pendingRecovery(snapshot, pending) === "confirmed";

    if (pendingConfirmed) {
      pending = undefined;
    }

    const state = store.getState();
    const empty =
      !pending &&
      !result.running &&
      state.messages.length === 0 &&
      state.surfaces.length === 0 &&
      state.pendingInterrupts.length === 0;

    if (savedEmpty !== empty || pendingConfirmed) {
      // Persist only the empty-page hint; history still comes from the server.
      saveConversation({
        threadId: saved.threadId,
        empty,
        ...(pending ? { pending } : {}),
      });
      savedEmpty = empty;
    }

    store.setState({
      lifecycle: transitionLifecycle(state.lifecycle, {
        type: "snapshot-received",
        locallyActive,
        running: result.running,
        needsRecovery: waitingForRun || waitingForOutputs,
        empty,
      }),
      issues: { ...state.issues, snapshot: null },
    });

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
    setIssue("snapshot", errorDetail(error, "Recovery failed"));
    updateLifecycle({
      type: "snapshot-failed",
      locallyActive: submission.active || agent.isRunning,
    });
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
    saveConversation({
      threadId: saved.threadId,
      pending: input,
      empty: false,
    });
    pending = input;
    savedEmpty = false;

    return runSubmission(input);
  }

  function busy() {
    const state = store.getState();

    return !connected || isRestoring(state) || isRunning(state);
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
    store.setState({
      surfaces: [],
      issues: { ...store.getState().issues, output: null },
    });

    const subscription = subscribeConversationAgent(agent, {
      onEvent({ event }) {
        if (!connected) {
          return;
        }

        if (event.type === EventType.RUN_STARTED) {
          // An accepted stream must eventually be represented in the saved snapshot.
          awaitingCheckpoint = true;
          updateLifecycle({ type: "stream-started" });
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
          setIssue("output", invalidOutputIssue);
        }

        if (event.type === EventType.RUN_ERROR) {
          submission.trace?.error(new Error(String(event.message)));
          updateRunStatus("failed");
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
        updateRunStatus(
          event.outcome?.type === "interrupt" ? "interrupted" : "completed",
        );
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

  function updateRunStatus(
    status: ConversationSnapshot["runs"][number]["status"],
  ) {
    store.setState((state) => ({
      runs: state.runs.map((run) =>
        run.runId === submittedRunId ? { ...run, status } : run,
      ),
    }));
  }

  return { store, connect, receiveSnapshot, receiveSnapshotError };
}

function errorDetail(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
