import type { RunAgentInput } from "@ag-ui/client";
import { runAgent, type AgentExecution } from "../../agent/run-execution.js";
import { admitRun } from "./run-admission.js";
import { claimPreparedDispatch, recordAegraRun } from "./run-store.js";
import { synchronizeConversation } from "./checkpoint-sync.js";
import { SubmissionError } from "../errors.js";
import { workflowFeedbackMessage } from "./review-validation.js";
import { prepareImageInput } from "../files/image-input.js";
import { fetchAgentInfo } from "../../agent/agent-info.js";
import { requestedModelId } from "./model-validation.js";

export interface PreparedConversationRun {
  input: RunAgentInput;
  modelId: string | null;
  releaseDispatch: () => void;
}

export async function prepareConversationRun(
  input: RunAgentInput,
): Promise<PreparedConversationRun> {
  // Only the server selects Aegra metadata, graph and disconnect behavior.
  const trustedInput = { ...input };

  delete trustedInput.forwardedProps;

  const selectedModel = requestedModelId(input);

  if (selectedModel !== undefined) {
    trustedInput.forwardedProps = { modelId: selectedModel };
  }

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
  const agentInfo = await fetchAgentInfo();
  const { row } = await admitRun({
    threadId: trustedInput.threadId,
    runId: trustedInput.runId,
    messageId,
    request: trustedInput,
    userMessage,
    isResume,
    agentInfo,
  });

  const releaseDispatch = await claimPreparedDispatch(trustedInput.runId);

  if (!releaseDispatch) {
    throw new SubmissionError("Submission already dispatched", 409);
  }

  return { input: modelInput, modelId: row.modelId, releaseDispatch };
}

export function executeConversationRun(
  prepared: PreparedConversationRun,
  onRunCreated: (id: string) => void,
): AgentExecution {
  const { input, modelId, releaseDispatch } = prepared;
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
      modelId,
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
