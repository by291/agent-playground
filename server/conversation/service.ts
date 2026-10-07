import type { RunAgentInput } from "@ag-ui/client";
import { runAgent, type AgentExecution } from "../agent/run";
import { admitRun, claimPreparedDispatch, recordAegraRun } from "./run-store";
import { synchronizeConversation } from "./checkpoint-sync";
import { SubmissionError } from "./errors";
import { workflowFeedbackMessage } from "./reviews";
import { prepareImageInput } from "./image-input";

export interface PreparedConversationRun {
  input: RunAgentInput;
  releaseDispatch: () => void;
}

export async function prepareConversationRun(
  input: RunAgentInput,
): Promise<PreparedConversationRun> {
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

  const releaseDispatch = await claimPreparedDispatch(trustedInput.runId);

  if (!releaseDispatch) {
    throw new SubmissionError("Submission already dispatched", 409);
  }

  return { input: modelInput, releaseDispatch };
}

export function executeConversationRun(
  prepared: PreparedConversationRun,
  onRunCreated: (id: string) => void,
): AgentExecution {
  const { input, releaseDispatch } = prepared;
  let mappingWrite = Promise.resolve();
  let mappingError: Error | undefined;

  try {
    const events = runAgent(
      input,
      (id) => {
        onRunCreated(id);
        // The callback cannot await. Retain its failure until execution settles.
        mappingWrite = recordAegraRun(input.runId, id)
          .then(releaseDispatch)
          .catch((error: unknown) => {
            mappingError =
              error instanceof Error
                ? error
                : new Error("Unable to save Aegra run mapping", {
                    cause: error,
                  });
          });
      },
      async () => {
        try {
          await mappingWrite;
        } finally {
          releaseDispatch();
        }
      },
    );

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
  } catch (error) {
    releaseDispatch();
    throw error;
  }
}
