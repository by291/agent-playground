import type { RunAgentInput } from "@ag-ui/client";
import { runAgent, type AgentExecution } from "../agent/run";
import { admitRun, claimPrepared, recordAegraRun } from "./run-store";
import { synchronizeConversation } from "./checkpoint-sync";
import { SubmissionError } from "./errors";

export async function prepareConversationRun(input: RunAgentInput) {
  // Only the server selects Aegra metadata, graph and disconnect behavior.
  const trustedInput = { ...input };

  delete trustedInput.forwardedProps;
  const isResume = !!trustedInput.resume?.length;
  const userMessage = isResume
    ? null
    : ([...trustedInput.messages]
        .reverse()
        .find((message) => message.role === "user") ?? null);
  const messageId = isResume ? trustedInput.runId : userMessage?.id;

  if (!messageId || (!isResume && !userMessage)) {
    throw new SubmissionError("Submission needs a user message", 400);
  }

  // Refresh only the current run; admission does not need the full conversation history.
  await synchronizeConversation(trustedInput.threadId);
  await admitRun({
    threadId: trustedInput.threadId,
    runId: trustedInput.runId,
    messageId,
    request: trustedInput,
    userMessage,
    isResume,
  });

  if (!(await claimPrepared(trustedInput.runId))) {
    throw new SubmissionError("Submission already dispatched", 409);
  }

  return trustedInput;
}

export function executeConversationRun(
  input: RunAgentInput,
  onRunCreated: (id: string) => void,
): AgentExecution {
  let mappingWrite = Promise.resolve();
  let mappingError: Error | undefined;
  const events = runAgent(input, (id) => {
    onRunCreated(id);
    // The callback cannot await. Retain its failure until execution settles.
    mappingWrite = recordAegraRun(input.runId, id).catch((error: unknown) => {
      mappingError =
        error instanceof Error
          ? error
          : new Error("Unable to save Aegra run mapping", { cause: error });
    });
  });

  return {
    events,

    async settle() {
      await mappingWrite;

      if (mappingError !== undefined) {
        throw mappingError;
      }

      await synchronizeConversation(input.threadId);
    },
  };
}
