import { parseExternalWait } from "@shared/external-task";
import {
  configureConversationAgent,
  subscribeConversationAgent,
} from "./http-agent";
import {
  EventType,
  HttpAgent,
  type Interrupt,
  type Message,
} from "@ag-ui/client";
import { createStore } from "zustand/vanilla";
import { parseA2UIEvent, type A2UIOutput } from "@/features/a2ui/index";
import { createA2UIRuntime } from "@/features/a2ui/index";
import {
  parsePlanReview,
  reviewEntries,
  type PlanReviewResponse,
} from "../model/plan-review";
import {
  reconcileSnapshot,
  pendingRecovery,
  pendingRetry,
  rejectedAdmission,
  confirmedAdmission,
} from "../model/reconciliation";
import {
  saveConversation,
  type ConversationReference,
} from "../model/conversation-storage";
import type { ConversationSnapshot, PendingSubmission } from "../api/contracts";
import type { ConversationState } from "../model/state";
import {
  initialLifecycle,
  transitionLifecycle,
  type LifecycleEvent,
} from "../model/lifecycle";
import { canSelectModel, isRunning, isRestoring } from "../model/selectors";
import { selectConversationModel } from "../api/models";
import { createSubmissionRunner } from "./submission";
import { isRunFinished } from "@shared/run-status";
import { parseContextUsage } from "@shared/context-usage";
import {
  mergeExternalTasks,
  projectOutputs,
} from "../model/session-projections";
import {
  parseWorkflowReview,
  reviewResponse,
  type WorkflowReview,
} from "@shared/workflow-review";

// Query ownership stays outside the session; a refresh requests a new result.
type RefreshSnapshot = () => Promise<void>;
const activityLimit = 500;

export function createConversationSession(
  saved: ConversationReference,
  agent = new HttpAgent({ url: "/agent", threadId: saved.threadId ?? "" }),
) {
  configureConversationAgent(agent);

  let connected = false;
  let threadId = saved.threadId;
  let pending = saved.pending;
  let pendingSnapshot: ConversationSnapshot | null | undefined;
  let admissionError: unknown;
  let acceptance:
    | { runId: string; notify: (() => void) | undefined; notified: boolean }
    | undefined;
  let savedEmpty = saved.empty;
  let savedModelId = saved.modelId ?? saved.pending?.modelId ?? null;
  let modelSelection: AbortController | undefined;
  let submittedRunId: string | undefined;
  let awaitingCheckpoint = false;
  let streamInterrupts: Interrupt[] | undefined;
  let refresh: RefreshSnapshot;
  let a2ui: ReturnType<typeof createA2UIRuntime> | undefined;
  let invalidOutputIssue: string | null = null;
  let recoveringOutputs = false;

  const store = createStore<ConversationState>()(() => ({
    threadId: threadId ?? null,
    ensureThreadId,
    contextUsage: null,
    modelId: savedModelId,
    modelSwitching: false,
    selectModel,
    externalTasks: [],
    runs: [],
    messages: [],
    messageTimestamps: pending?.submittedAt
      ? { [pending.messageId]: pending.submittedAt }
      : {},
    surfaces: [],
    activity: [],
    activityReceived: 0,
    pendingInterrupts: [],
    lifecycle: initialLifecycle(saved),
    animatedMessageId: null,
    issues: { run: null, snapshot: null, output: null },
    send,
    clearActivity: () => store.setState({ activity: [], activityReceived: 0 }),
    reviewPlan,
    reviewWorkflow,
  }));
  const submission = createSubmissionRunner(ensureThreadId, agent, {
    started() {
      admissionError = undefined;
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

      const messageTimestamps = { ...store.getState().messageTimestamps };
      const submittedMessage = pending?.messages.find(
        (message) =>
          message.id === pending?.messageId && message.role === "user",
      );

      if (
        submittedMessage &&
        pending?.submittedAt &&
        !messageTimestamps[submittedMessage.id]
      ) {
        messageTimestamps[submittedMessage.id] = pending.submittedAt;
      }

      store.setState({
        runs,
        messages: [...agent.messages],
        messageTimestamps,
        lifecycle: transitionLifecycle(store.getState().lifecycle, {
          type: "submission-started",
        }),
        issues: { ...store.getState().issues, run: null },
      });
    },

    failed(error, accepted) {
      if (!accepted) {
        admissionError = error;
      }

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

  function receiveOutputs(outputs: A2UIOutput[], receivedAt?: string) {
    const result = a2ui?.ingest(outputs);

    if (!result) {
      return false;
    }

    const projection = projectOutputs(
      outputs,
      result,
      agent.messages,
      invalidOutputIssue,
    );

    if (projection.replies.length) {
      agent.setMessages([...agent.messages, ...projection.replies]);
      store.setState({ messages: [...agent.messages] });

      if (receivedAt) {
        store.setState((state) => ({
          messageTimestamps: {
            ...Object.fromEntries(
              projection.replies.map((reply) => [reply.id, receivedAt]),
            ),
            ...state.messageTimestamps,
          },
        }));
      }
    }

    if (
      projection.error &&
      projection.error !== store.getState().issues.output
    ) {
      submission.trace?.error(new Error(projection.error));
    }

    store.setState({
      surfaces: projection.surfaces,
      issues: {
        ...store.getState().issues,
        output: projection.issue,
      },
    });

    return projection.waiting;
  }

  function receiveContextUsage(value: unknown) {
    const usage = parseContextUsage(value);
    const current = store.getState().contextUsage;

    if (
      usage &&
      (usage.model !== current?.model || usage.revision >= current.revision)
    ) {
      store.setState({ contextUsage: usage });
    }
  }

  function receiveSnapshot(snapshot: ConversationSnapshot | null) {
    if (!connected) {
      return;
    }

    store.setState({
      externalTasks: mergeExternalTasks(
        store.getState().externalTasks,
        snapshot?.externalTasks ?? [],
      ),
    });

    const pendingRejected =
      pending && rejectedAdmission(snapshot, pending, admissionError);

    if (pendingRejected) {
      pending = undefined;
      submittedRunId = undefined;
      acceptance = undefined;
      agent.setMessages(snapshot?.messages ?? []);
    }

    if (acceptance && confirmedAdmission(snapshot, acceptance.runId)) {
      acceptSubmission(acceptance.runId);
    }

    const initialPending = isRestoring(store.getState()) ? pending : undefined;
    const locallyActive = submission.active || agent.isRunning;

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
        // A snapshot can observe dispatch before the creation callback saves its
        // mapping. The local request is still in flight during that uncertainty.
        const uncertainDuringLocalRequest =
          locallyActive && run.status === "submission_unknown";

        if (
          run.runId === localRun?.runId &&
          ((isRunFinished(localRun.status) && !isRunFinished(run.status)) ||
            uncertainDuringLocalRequest)
        ) {
          return { ...run, status: localRun.status };
        }

        return run;
      });

      const state = store.getState();
      // Uploads can create a server row before admission pins its first model.
      const preserveLocalModel =
        state.modelSwitching ||
        !snapshot ||
        (snapshot.runs.length === 0 && !snapshot.modelId);

      receiveContextUsage(snapshot?.contextUsage);
      agent.setMessages(result.messages);
      store.setState({
        title: snapshot?.title,
        modelId: preserveLocalModel
          ? state.modelId
          : (snapshot?.modelId ?? null),
        messages: [...agent.messages],
        messageTimestamps: {
          ...state.messageTimestamps,
          ...snapshot?.messageTimestamps,
        },
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

    const pendingConfirmed =
      pending && pendingRecovery(snapshot, pending) === "confirmed";

    pendingSnapshot = snapshot;

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

    if (
      threadId &&
      (savedEmpty !== empty ||
        savedModelId !== state.modelId ||
        pendingConfirmed ||
        pendingRejected)
    ) {
      // Persist the local choice and admission hints; history comes from the server.
      saveConversation({
        threadId,
        empty,
        ...(pending ? { pending } : {}),
        ...(state.modelId ? { modelId: state.modelId } : {}),
      });
      savedEmpty = empty;
      savedModelId = state.modelId;
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
      void runSubmission(initialPending).catch(() => undefined);
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

  function runSubmission(input: PendingSubmission, onAccepted?: () => void) {
    if (!connected || submission.active) {
      return Promise.resolve();
    }

    submittedRunId = input.runId;
    acceptance = { runId: input.runId, notify: onAccepted, notified: false };

    return submission.run(input, () => acceptSubmission(input.runId));
  }

  function acceptSubmission(runId: string) {
    if (!connected || acceptance?.runId !== runId || acceptance.notified) {
      return;
    }

    // A lost stream response can be confirmed later by its saved run snapshot.
    acceptance.notified = true;
    acceptance.notify?.();
  }

  function submit(input: PendingSubmission, onAccepted?: () => void) {
    if (pending) {
      const recovery = pendingRetry(pendingSnapshot, pending, input);

      if (recovery !== "retry") {
        const detail =
          recovery === "changed"
            ? "Retry the original submission before sending edited input."
            : "The earlier submission is still being reconciled. Please wait before retrying.";

        setIssue("run", detail);
        void requestSnapshot();

        return Promise.reject(new Error(detail));
      }

      return runSubmission(pending, onAccepted);
    }

    input = {
      ...input,
      submittedAt: input.submittedAt ?? new Date().toISOString(),
    };

    // Save before sending so a reload can retry exactly the same admission.
    try {
      saveConversation({
        threadId: ensureThreadId(),
        pending: input,
        empty: false,
        ...(store.getState().modelId
          ? { modelId: store.getState().modelId! }
          : {}),
      });
    } catch (error) {
      const failure =
        error instanceof Error
          ? error
          : new Error("Cannot save this submission");

      setIssue("run", failure.message);

      return Promise.reject(failure);
    }

    pending = input;
    pendingSnapshot = undefined;
    savedEmpty = false;

    return runSubmission(input, onAccepted);
  }

  function ensureThreadId() {
    if (threadId) {
      return threadId;
    }

    threadId = crypto.randomUUID();
    agent.threadId = threadId;
    saveConversation({
      threadId,
      empty: true,
      ...(store.getState().modelId
        ? { modelId: store.getState().modelId! }
        : {}),
    });
    store.setState({ threadId });

    return threadId;
  }

  function busy() {
    const state = store.getState();

    return (
      !connected ||
      state.modelSwitching ||
      isRestoring(state) ||
      isRunning(state)
    );
  }

  async function selectModel(modelId: string): Promise<void> {
    const state = store.getState();

    if (!connected || pending || !canSelectModel(state)) {
      throw new Error(
        "Wait for conversation work to finish before changing its model",
      );
    }

    if (modelId === state.modelId) {
      return;
    }

    const controller = new AbortController();

    modelSelection = controller;
    store.setState({ modelSwitching: true });

    try {
      if (pendingSnapshot) {
        await selectConversationModel(
          ensureThreadId(),
          modelId,
          controller.signal,
        );
        await requestSnapshot();
      }

      if (!connected || controller.signal.aborted) {
        return;
      }

      saveConversation({
        threadId: ensureThreadId(),
        empty: state.lifecycle.emptyHint,
        modelId,
      });
      savedModelId = modelId;
      store.setState({ modelId, contextUsage: null });
    } catch (error) {
      if (connected && !controller.signal.aborted) {
        void requestSnapshot();
      }

      throw error;
    } finally {
      if (modelSelection === controller) {
        modelSelection = undefined;
        store.setState({ modelSwitching: false });
      }
    }
  }

  function send(content: string, onAccepted?: () => void): Promise<void> {
    const text = content.trim();

    if (!text || busy()) {
      return Promise.resolve();
    }

    const previousMessage = pending?.messages.at(-1);

    if (
      pending &&
      previousMessage?.role === "user" &&
      previousMessage.id === pending.messageId &&
      previousMessage.content === text
    ) {
      return submit(pending, onAccepted);
    }

    const message: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
    };

    const interrupts = store.getState().pendingInterrupts;

    if (interrupts.length) {
      const review =
        interrupts.length === 1 ? parseWorkflowReview(interrupts[0]!) : null;
      const entry = review
        ? reviewResponse(review, "message", { id: message.id, content: text })
        : null;

      if (!entry) {
        if (!review) {
          return Promise.resolve();
        }

        const detail =
          review && text.length > 10000
            ? "Workflow feedback must be at most 10,000 characters, including attachment references."
            : "This workflow review cannot accept a message.";

        setIssue("run", detail);

        return Promise.reject(new Error(detail));
      }

      return submit(
        {
          runId: crypto.randomUUID(),
          messageId: message.id,
          messages: [...agent.messages, message],
          state: structuredClone(agent.state as Record<string, unknown>),
          resume: [entry],
        },
        onAccepted,
      );
    }

    return submit(
      {
        runId: crypto.randomUUID(),
        messageId: message.id,
        messages: [...agent.messages, message],
        state: structuredClone(agent.state as Record<string, unknown>),
        ...(store.getState().modelId
          ? { modelId: store.getState().modelId! }
          : {}),
      },
      onAccepted,
    );
  }

  function reviewPlan(responses: PlanReviewResponse[]): Promise<void> {
    if (busy()) {
      return Promise.resolve();
    }

    const interrupts = store.getState().pendingInterrupts;
    const mixed = interrupts.some(
      (interrupt) =>
        parseWorkflowReview(interrupt) !== null ||
        parseExternalWait(interrupt) !== null,
    );
    const resume = reviewEntries(
      responses,
      mixed
        ? interrupts.filter((interrupt) => parsePlanReview(interrupt) !== null)
        : interrupts,
    );

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

  function reviewWorkflow(
    review: WorkflowReview,
    action: "accept" | "abandon",
  ): Promise<void> {
    const interrupts = store.getState().pendingInterrupts;
    const interrupt = interrupts.find((item) => item.id === review.interruptId);
    const current = interrupt ? parseWorkflowReview(interrupt) : null;

    if (
      busy() ||
      current?.interruptId !== review.interruptId ||
      current.round !== review.round ||
      current.revision !== review.revision
    ) {
      return Promise.resolve();
    }

    const entry = reviewResponse(current, action);

    if (!entry) {
      return Promise.resolve();
    }

    const runId = crypto.randomUUID();

    return submit({
      runId,
      messageId: runId,
      messages: [...agent.messages],
      state: structuredClone(agent.state as Record<string, unknown>),
      resume: [entry],
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
      onEvent({ event, input }) {
        if (!connected) {
          return;
        }

        const eventDate = new Date(event.timestamp ?? Date.now());
        const receivedAt = Number.isNaN(eventDate.getTime())
          ? new Date().toISOString()
          : eventDate.toISOString();

        if (
          (event.type === EventType.TEXT_MESSAGE_START ||
            event.type === EventType.TEXT_MESSAGE_CONTENT) &&
          typeof event.messageId === "string"
        ) {
          const messageId = event.messageId;

          if (!store.getState().messageTimestamps[messageId]) {
            store.setState((state) => ({
              messageTimestamps: {
                ...state.messageTimestamps,
                [messageId]: receivedAt,
              },
            }));
          }
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

          if (output && receiveOutputs([output], receivedAt)) {
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

        if (event.type === EventType.RAW) {
          return;
        }

        if (import.meta.env.DEV) {
          store.setState((state) => ({
            activityReceived: state.activityReceived + 1,
            activity: [
              {
                id: crypto.randomUUID(),
                receivedAt: Date.now(),
                runId: input.runId,
                event: structuredClone(event),
              },
              ...state.activity,
            ].slice(0, activityLimit),
          }));
        }
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
      modelSelection?.abort();
      submission.trace?.outcome("disconnected");
      subscription.unsubscribe();
      a2ui?.dispose();
      a2ui = undefined;
      // Detach processing before aborting HTTP: the SDK's event transform keeps
      // its source subscription alive. The server-owned Aegra run continues.
      void agent.detachActiveRun();
      agent.abortRun();
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
