import type { Interrupt, Message } from "@ag-ui/client";
import { isRunActive, isRunFinished } from "@shared/run-status";
import type { ConversationSnapshot, PendingSubmission } from "../api/contracts";

interface LocalRun {
  submittedRunId: string | undefined;
  submitting: boolean;
  streaming: boolean;
  messages: Message[];
  interrupts: Interrupt[] | undefined;
}

export function reconcileSnapshot(
  snapshot: ConversationSnapshot | null,
  local: LocalRun,
) {
  const latest = snapshot?.runs.at(-1);
  const serverRunning = latest
    ? isRunActive(latest.status) || latest.status === "submission_unknown"
    : false;
  const locallyRunning = local.submitting || local.streaming;

  // An older fetch must not replace a new stream or unlock its composer.
  const submitted = snapshot?.runs.find(
    (run) => run.runId === local.submittedRunId,
  );
  const newerContinuation =
    submitted && isRunFinished(submitted.status) && !locallyRunning;

  if (
    local.submittedRunId &&
    latest?.runId !== local.submittedRunId &&
    !newerContinuation
  ) {
    return { kind: "stale" as const, running: locallyRunning || serverRunning };
  }

  const canonical = !!latest && isRunFinished(latest.status) && !locallyRunning;
  let messages = local.messages;

  if (snapshot && !locallyRunning) {
    messages = canonical
      ? snapshot.messages
      : mergeCheckpointAndStream(snapshot.messages, local.messages);
  }

  let issue: string | null = null;

  if (latest?.status === "submission_unknown" && !locallyRunning) {
    issue =
      "Submission status is unknown. Review the server state before retrying.";
  } else if (latest?.status === "failed") {
    issue = "The agent run failed. Saved cards remain available.";
  }

  return {
    kind: "current" as const,
    canonical,
    messages,
    interrupts: local.interrupts ?? snapshot?.interrupts ?? [],
    running: locallyRunning || serverRunning,
    issue,
  };
}

export function pendingRecovery(
  snapshot: ConversationSnapshot | null,
  pending: PendingSubmission,
) {
  const saved = snapshot?.runs.find((run) => run.runId === pending.runId);

  return !saved || saved.status === "prepared" ? "retry" : "confirmed";
}

export function pendingRetry(
  snapshot: ConversationSnapshot | null | undefined,
  pending: PendingSubmission,
  candidate: PendingSubmission,
) {
  if (
    snapshot === undefined ||
    pendingRecovery(snapshot, pending) !== "retry"
  ) {
    return "reconcile";
  }

  // A missing response permits replay of the saved operation, not a new operation
  // with edited input. Resume payloads also preserve the original review decision.
  const sameInput =
    candidate === pending ||
    JSON.stringify({
      messages: pending.messages,
      state: pending.state,
      resume: pending.resume,
      modelId: pending.modelId,
    }) ===
      JSON.stringify({
        messages: candidate.messages,
        state: candidate.state,
        resume: candidate.resume,
        modelId: candidate.modelId,
      });

  return sameInput ? "retry" : "changed";
}

export function rejectedAdmission(
  snapshot: ConversationSnapshot | null,
  pending: PendingSubmission,
  error: unknown,
) {
  // These responses reject input before admission. A snapshot must also confirm
  // that this operation has no saved run before edited input can replace it.
  const status =
    error instanceof Error && "status" in error ? error.status : undefined;

  return (
    typeof status === "number" &&
    [400, 404, 409, 413].includes(status) &&
    !snapshot?.runs.some((run) => run.runId === pending.runId)
  );
}

export function confirmedAdmission(
  snapshot: ConversationSnapshot | null,
  runId: string,
) {
  const run = snapshot?.runs.find((item) => item.runId === runId);

  return !!run && (run.status === "running" || isRunFinished(run.status));
}

function mergeCheckpointAndStream(
  checkpoint: Message[],
  stream: Message[],
): Message[] {
  const byId = new Map(checkpoint.map((message) => [message.id, message]));

  // The disconnected stream can contain newer content until a final checkpoint arrives.
  for (const message of stream) {
    byId.set(message.id, message);
  }

  return [...byId.values()];
}
