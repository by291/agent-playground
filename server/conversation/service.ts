import type { RunAgentInput } from "@ag-ui/client";
import { runAgent, type AgentExecution } from "../agent/run";
import { admitRun, claimPrepared, recordAegraRun } from "./run-store";
import { synchronizeConversation } from "./checkpoint-sync";
import { SubmissionError } from "./errors";
import { workflowFeedbackMessage } from "./reviews";
import { prepareImageInput } from "./image-input";

export async function prepareConversationRun(input: RunAgentInput) {
  // Only the server selects Aegra metadata, graph and disconnect behavior.
  const trustedInput = { ...input };

  delete trustedInput.forwardedProps;
  const isResume = !!trustedInput.resume?.length;
  const userMessage = isResume
    ? workflowFeedbackMessage(trustedInput)
    : ([...trustedInput.messages]
        .reverse()
        .find((message) => message.role === "user") ?? null);
  const messageId =
    userMessage?.id ?? (isResume ? trustedInput.runId : undefined);

  if (!messageId || (!isResume && !userMessage)) {
    throw new SubmissionError("Submission needs a user message", 400);
  }

  // Resolve only this turn before admission so file errors preserve the client draft.
  const modelInput = userMessage
    ? await prepareImageInput(trustedInput, userMessage)
    : trustedInput;

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

  return modelInput;
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
