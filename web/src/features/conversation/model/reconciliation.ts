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
  const serverRunning = latest ? isRunActive(latest.status) : false;
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

  if (latest?.status === "submission_unknown") {
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
