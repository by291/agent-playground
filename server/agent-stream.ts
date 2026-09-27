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
import { recordAegraRun } from "./run-store";
import { aegraClient, ReviewLangGraphAgent } from "./hitl";
import { reconcileRun } from "./recovery";
import { normalizeRunEvent } from "./run-events";
import type { RunRow } from "./schema";

const aegraUrl = process.env.AEGRA_URL ?? "http://127.0.0.1:2026";

export function streamAgent(
  context: Context,
  trustedInput: RunAgentInput,
  run: RunRow,
) {
  // The adapter keeps run state, so each request gets its own instance.
  const agent = new ReviewLangGraphAgent({
    graphId: "agent",
    deploymentUrl: aegraUrl,
    client: aegraClient(aegraUrl),
    emitInterruptOutcome: true,
    enableLegacyOnInterruptEvent: false,
  });
  context.header("Cache-Control", "no-cache, no-transform");
  context.header("X-Accel-Buffering", "no");

  return streamSSE(context, async (stream) => {
    const cancelled = new Subject<void>();
    let mappingWrite: Promise<void> | undefined;
    let mappingError: unknown;
    let lastSnapshot: string | undefined;
    let runStarted = false;
    let terminalEventSent = false;

    stream.onAbort(() => {
      // Aegra continues the run; the browser can recover from persisted state.
      cancelled.next();
      cancelled.complete();
    });

    try {
      await lastValueFrom(
        agent
          .run({
            ...trustedInput,
            forwardedProps: {
              config: { metadata: { agui_run_id: trustedInput.runId } },
              onDisconnect: "continue",
              onRunCreated: ({ run_id }: { run_id: string }) => {
                mappingWrite = recordAegraRun(trustedInput.runId, run_id);
                void mappingWrite.catch((error: unknown) => {
                  mappingError = error;
                });
              },
            },
          })
          .pipe(
            filter((event) => {
              if (event.type === EventType.RAW) return false;
              if (event.type !== EventType.STATE_SNAPSHOT) return true;

              const snapshot = JSON.stringify(event.snapshot);
              if (snapshot === lastSnapshot) return false;
              lastSnapshot = snapshot;
              return true;
            }),
            map((event) => {
              const output = normalizeRunEvent(event, trustedInput.runId);
              const clean = { ...output } as Record<string, unknown>;
              delete clean.rawEvent;
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
              if (notification.kind !== "N") return;

              const event = notification.value;
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
              if (event.type === EventType.RUN_STARTED) runStarted = true;
              if (
                event.type === EventType.RUN_ERROR ||
                event.type === EventType.RUN_FINISHED
              )
                terminalEventSent = true;
            }),
            takeUntil(cancelled),
          ),
        { defaultValue: undefined },
      );
      await mappingWrite;
      if (mappingError) {
        throw mappingError instanceof Error
          ? mappingError
          : new Error("Aegra run mapping failed");
      }
      await reconcileRun({ ...run, status: "dispatching" });
    } catch (error) {
      console.error("Agent stream failed", error ?? "Unknown error");
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
  });
}
