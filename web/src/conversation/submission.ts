import type { HttpAgent } from "@ag-ui/client";
import type { PendingSubmission } from "./contracts";
import { startSubmissionTrace } from "../observability/tracing";

interface SubmissionCallbacks {
  started: () => void;
  failed: (error: unknown) => void;
  settled: () => Promise<void>;
}

export function createSubmissionRunner(
  threadId: string,
  agent: HttpAgent,
  callbacks: SubmissionCallbacks,
) {
  let active = false;
  let observation: ReturnType<typeof startSubmissionTrace> | undefined;

  return {
    get active() {
      return active;
    },

    get trace() {
      return observation;
    },

    async run(submission: PendingSubmission) {
      if (active) {
        return;
      }

      active = true;
      observation = startSubmissionTrace(threadId, submission.runId);
      const originalHeaders = agent.headers;

      agent.headers = { ...originalHeaders, ...observation.headers };
      agent.setMessages(submission.messages);
      agent.setState(submission.state);
      callbacks.started();

      try {
        await agent.runAgent({
          runId: submission.runId,
          ...(submission.resume ? { resume: submission.resume } : {}),
        });
      } catch (error) {
        observation.error(error);
        callbacks.failed(error);
      } finally {
        observation.finish();
        observation = undefined;
        agent.headers = originalHeaders;
        active = false;

        await callbacks.settled();
      }
    },
  };
}
