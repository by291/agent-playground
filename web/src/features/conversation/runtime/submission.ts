import type { HttpAgent } from "@ag-ui/client";
import type { PendingSubmission } from "../api/contracts";
import { startSubmissionTrace } from "@/shared/observability/tracing";

interface SubmissionCallbacks {
  started: () => void;
  failed: (error: unknown, accepted: boolean) => void;
  settled: () => Promise<void>;
}

/** Serializes local submissions and owns their temporary SDK headers and trace. */
export function createSubmissionRunner(
  getThreadId: () => string,
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

    async run(submission: PendingSubmission, onAccepted?: () => void) {
      if (active) {
        return;
      }

      active = true;
      observation = startSubmissionTrace(getThreadId(), submission.runId);

      const originalHeaders = agent.headers;

      agent.headers = { ...originalHeaders, ...observation.headers };
      agent.setMessages(submission.messages);
      agent.setState(submission.state);
      callbacks.started();

      const pendingInterrupts = agent.pendingInterrupts;
      const resumeIds = new Set(
        submission.resume?.map((entry) => entry.interruptId),
      );
      const scopedInterrupts = pendingInterrupts.filter((interrupt) =>
        resumeIds.has(interrupt.id),
      );

      if (resumeIds.size) {
        // Independent pauses can be answered separately. Scope the SDK's
        // all-covered guard to this response; server admission validates it
        // against the complete checkpoint without resolving the other pauses.
        agent.pendingInterrupts = scopedInterrupts;
      }

      let accepted = false;
      const subscription = agent.subscribe({
        onRunStartedEvent({ event }) {
          if (!accepted && event.runId === submission.runId) {
            accepted = true;
            onAccepted?.();
          }
        },
      });

      try {
        await agent.runAgent({
          runId: submission.runId,
          ...(submission.modelId
            ? { forwardedProps: { modelId: submission.modelId } }
            : {}),
          ...(submission.resume ? { resume: submission.resume } : {}),
        });

        if (!accepted) {
          throw new Error(
            "Submission ended before admission was confirmed. Please retry.",
          );
        }
      } catch (error) {
        observation.error(error);
        callbacks.failed(error, accepted);

        if (!accepted) {
          // A missing response does not prove rejection; preserve the saved operation ID.
          throw error;
        }
      } finally {
        // Release stream observers before settlement asks Query for the saved snapshot.
        subscription.unsubscribe();
        observation.finish();
        observation = undefined;

        if (agent.pendingInterrupts === scopedInterrupts) {
          // A terminal event replaces this list. Restore it only when the
          // request failed or disconnected before the SDK received that event.
          agent.pendingInterrupts = pendingInterrupts;
        }

        agent.headers = originalHeaders;
        active = false;

        if (accepted) {
          await callbacks.settled();
        } else {
          // Report admission failure promptly while the snapshot owner reconciles uncertainty.
          void callbacks.settled().catch(() => undefined);
        }
      }
    },
  };
}
