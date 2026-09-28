import {
  EventType,
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
import type { AgentExecution } from "./run";
import { normalizeRunEvent } from "./run-events";
import { observeAgentStream } from "../observability/agent-stream";
import { logger } from "../observability/logger";

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
      const cancelled = new Subject<void>();
      let lastSnapshot: string | undefined;
      let runStarted = false;
      let terminalEventSent = false;

      stream.onAbort(() => {
        // Aegra continues the run; the browser can recover from persisted state.
        cancelled.next();
        cancelled.complete();
      });

      try {
        const execution = createExecution(observation.runCreated);

        await lastValueFrom(
          execution.events.pipe(
            filter((event) => {
              if (
                event.type === EventType.RAW ||
                event.type === EventType.MESSAGES_SNAPSHOT
              ) {
                return false;
              }

              if (event.type !== EventType.STATE_SNAPSHOT) {
                return true;
              }

              const snapshot = JSON.stringify(event.snapshot);

              if (snapshot === lastSnapshot) {
                return false;
              }

              lastSnapshot = snapshot;

              return true;
            }),
            map((event) => {
              const output = normalizeRunEvent(event, trustedInput.runId);
              const clean = { ...output } as Record<string, unknown>;

              delete clean.rawEvent;

              if (
                event.type === EventType.STATE_SNAPSHOT &&
                event.snapshot &&
                typeof event.snapshot === "object"
              ) {
                const snapshot = {
                  ...(event.snapshot as Record<string, unknown>),
                };

                // Public messages are recovered from the archive, not compressed model state.
                delete snapshot.messages;
                delete snapshot.response_messages;
                clean.snapshot = snapshot;
              }

              return clean;
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

              if (
                !runStarted &&
                (event.type === EventType.RUN_ERROR ||
                  event.type === EventType.RUN_FINISHED)
              ) {
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

              if (
                event.type === EventType.RUN_ERROR ||
                event.type === EventType.RUN_FINISHED
              ) {
                terminalEventSent = true;
              }
            }),
            takeUntil(cancelled),
          ),
          { defaultValue: undefined },
        );

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
