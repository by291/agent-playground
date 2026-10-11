import {
  EventType,
  type AGUIEvent,
  type RunAgentInput,
  type RunErrorEvent,
  type RunStartedEvent,
} from "@ag-ui/client";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import {
  concatMap,
  filter,
  lastValueFrom,
  map,
  materialize,
  Subject,
  takeUntil,
} from "rxjs";
import type { AgentExecution } from "../agent/run-execution.js";
import { normalizeRunEvent } from "../agent/run-events.js";
import { observeAgentStream } from "./run-observation.js";
import { logger } from "../observability/logger.js";
import { publicToolErrors } from "../agent/checkpoint-messages.js";

function publicRunEvent(
  event: AGUIEvent,
  runId: string,
): Record<string, unknown> {
  const normalized = normalizeRunEvent(event, runId);
  const publicEvent = { ...normalized } as Record<string, unknown>;

  delete publicEvent.rawEvent;

  if (
    event.type === EventType.STATE_SNAPSHOT &&
    event.snapshot &&
    typeof event.snapshot === "object"
  ) {
    const snapshot = { ...(event.snapshot as Record<string, unknown>) };

    // The adapter omits results for handled tool errors. Keep their official
    // ToolMessages in public state while the model continues.
    snapshot.toolErrors = publicToolErrors(snapshot);

    // Public messages are recovered from the archive, not compressed model state.
    delete snapshot.messages;
    delete snapshot.response_messages;
    publicEvent.snapshot = snapshot;
  }

  return publicEvent;
}

/** Detaches the HTTP consumer on abort while Aegra continues the admitted run. */
export function streamAgent(
  context: Context,
  trustedInput: RunAgentInput,
  createExecution: (onRunCreated: (id: string) => void) => AgentExecution,
) {
  context.header("Cache-Control", "no-cache, no-transform");
  context.header("X-Accel-Buffering", "no");

  return streamSSE(
    context,
    observeAgentStream(trustedInput, async (stream, observation) => {
      const detached = new Subject<void>();
      let lastPublicSnapshot: string | undefined;
      let runStarted = false;
      let terminalEventSent = false;

      stream.onAbort(() => {
        // Aegra continues the run; the browser can recover from persisted state.
        detached.next();
        detached.complete();
      });

      try {
        const execution = createExecution(observation.runCreated);

        await lastValueFrom(
          execution.events.pipe(
            filter((event) => {
              return !(
                event.type === EventType.RAW ||
                event.type === EventType.MESSAGES_SNAPSHOT
              );
            }),
            map((event) => publicRunEvent(event, trustedInput.runId)),
            filter((event) => {
              if (event.type !== EventType.STATE_SNAPSHOT) {
                return true;
              }

              // Compare the small public state, not private model history.
              const snapshot = JSON.stringify(event.snapshot);

              if (snapshot === lastPublicSnapshot) {
                return false;
              }

              lastPublicSnapshot = snapshot;

              return true;
            }),
            // Treat an upstream error as the last queued item so earlier writes finish.
            materialize(),
            concatMap(async (notification) => {
              if (notification.kind === "E") {
                throw notification.error instanceof Error
                  ? notification.error
                  : new Error("Agent stream failed");
              }

              if (notification.kind !== "N") {
                return;
              }

              const event = notification.value;

              observation.event(event);

              const terminalEvent =
                event.type === EventType.RUN_ERROR ||
                event.type === EventType.RUN_FINISHED;

              // Creation may fail before the adapter starts its public run lifecycle.
              if (!runStarted && terminalEvent) {
                const runStart: RunStartedEvent = {
                  type: EventType.RUN_STARTED,
                  threadId: trustedInput.threadId,
                  runId: trustedInput.runId,
                };

                await stream.writeSSE({ data: JSON.stringify(runStart) });
                runStarted = true;
              }

              await stream.writeSSE({ data: JSON.stringify(event) });

              if (event.type === EventType.RUN_STARTED) {
                runStarted = true;
              }

              if (terminalEvent) {
                terminalEventSent = true;
              }
            }),
            takeUntil(detached),
          ),
          { defaultValue: undefined },
        );

        // Wait for the mapping write and checkpoint sync after forwarding has stopped.
        await execution.settle();
      } catch (error) {
        observation.failed(error);
        logger.error(
          {
            err: error,
            thread_id: trustedInput.threadId,
            agui_run_id: trustedInput.runId,
          },
          "Agent stream failed",
        );

        if (!stream.aborted && !terminalEventSent) {
          if (!runStarted) {
            const runStart: RunStartedEvent = {
              type: EventType.RUN_STARTED,
              threadId: trustedInput.threadId,
              runId: trustedInput.runId,
            };

            await stream.writeSSE({ data: JSON.stringify(runStart) });
          }

          const runError: RunErrorEvent = {
            type: EventType.RUN_ERROR,
            message: "Agent run failed",
          };

          await stream.writeSSE({
            data: JSON.stringify(runError),
          });
        }
      }
    }),
  );
}
