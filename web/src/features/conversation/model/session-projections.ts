import type { Message } from "@ag-ui/client";
import type { ExternalTaskSnapshot } from "@shared/external-task";
import { isRunFinished } from "@shared/run-status";
import { workflowReplyMessages } from "@shared/workflow-output";
import type { A2UIIngestResult } from "@/features/a2ui";

/** Merges task revisions without letting a late snapshot reopen a continuation. */
export function mergeExternalTasks(
  currentTasks: ExternalTaskSnapshot[],
  incomingTasks: ExternalTaskSnapshot[],
): ExternalTaskSnapshot[] {
  const tasks = new Map(currentTasks.map((task) => [task.taskId, task]));

  for (const incoming of incomingTasks) {
    const current = tasks.get(incoming.taskId);

    // Continuation progress can advance independently within the same task revision.
    const staleContinuation =
      incoming.revision === current?.revision &&
      current.continuationStatus !== null &&
      (incoming.continuationStatus === null ||
        (isRunFinished(current.continuationStatus) &&
          !isRunFinished(incoming.continuationStatus)));

    if (
      !staleContinuation &&
      (!current || incoming.revision >= current.revision)
    ) {
      tasks.set(incoming.taskId, incoming);
    }
  }

  return [...tasks.values()];
}

/** Publishes reply text only after the corresponding A2UI output sequence is complete. */
export function projectOutputs(
  result: A2UIIngestResult,
  messages: Message[],
  invalidOutputIssue: string | null,
) {
  const savedIds = new Set(messages.map((message) => message.id));
  const replies: Message[] = [];

  for (const output of result.appliedOutputs) {
    for (const reply of workflowReplyMessages(output)) {
      if (!savedIds.has(reply.id)) {
        savedIds.add(reply.id);
        replies.push(reply);
      }
    }
  }

  let issue: string | null = null;

  if (result.kind === "failed") {
    issue = result.error;
  } else if (result.kind === "waiting") {
    issue = `Waiting for A2UI output ${result.missingOutputSeq} to recover.`;
  }

  return {
    replies,
    surfaces: result.surfaces,
    issue: invalidOutputIssue ?? issue,
    waiting: result.kind === "waiting",
    error: result.kind === "failed" ? result.error : null,
  };
}
