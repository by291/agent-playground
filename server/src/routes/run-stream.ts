import {
  EventType,
  type AGUIEvent,
  type RunAgentInput,
  type RunErrorEvent,
  type RunStartedEvent,
} from "@ag-ui/client";
import type { Context } from "hono";
import { streamSSE, type SSEStreamingApi } from "hono/streaming";
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

interface ForwardAgentEventsOptions {
  events: AgentExecution["events"];
  detached: Subject<void>;
  runId: string;
  writeEvent: (event: Record<string, unknown>) => Promise<void>;
}

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

// Keep the written lifecycle available if forwarding or settlement fails.
function createRunEventWriter(stream: SSEStreamingApi, input: RunAgentInput) {
  let hasRunStarted = false;
  let hasTerminalEvent = false;

  async function writeRunStart() {
    const runStart: RunStartedEvent = {
      type: EventType.RUN_STARTED,
      threadId: input.threadId,
      runId: input.runId,
    };

    await stream.writeSSE({ data: JSON.stringify(runStart) });
    hasRunStarted = true;
  }

  async function writeEvent(event: Record<string, unknown>) {
    const isTerminalEvent =
      event.type === EventType.RUN_ERROR ||
      event.type === EventType.RUN_FINISHED;

    // Creation may fail before the adapter starts the public run lifecycle.
    if (!hasRunStarted && isTerminalEvent) {
      await writeRunStart();
    }

    await stream.writeSSE({ data: JSON.stringify(event) });

    if (event.type === EventType.RUN_STARTED) {
      hasRunStarted = true;
    }

    if (isTerminalEvent) {
      hasTerminalEvent = true;
    }
  }

  async function reportFailure() {
    if (stream.aborted || hasTerminalEvent) {
      return;
    }

    if (!hasRunStarted) {
      await writeRunStart();
    }

    const runError: RunErrorEvent = {
      type: EventType.RUN_ERROR,
      message: "Agent run failed",
    };

    await stream.writeSSE({ data: JSON.stringify(runError) });
  }

  return { writeEvent, reportFailure };
}

async function forwardAgentEvents({
  events,
  detached,
  runId,
  writeEvent,
}: ForwardAgentEventsOptions) {
  let lastPublicSnapshot: string | undefined;
  const publicEvents = events.pipe(
    filter(
      (event) =>
        event.type !== EventType.RAW &&
        event.type !== EventType.MESSAGES_SNAPSHOT,
    ),
    map((event) => publicRunEvent(event, runId)),
    filter((event) => {
      if (event.type !== EventType.STATE_SNAPSHOT) {
        return true;
      }

      // Compare only the public state so model-history changes do not republish it.
      const snapshot = JSON.stringify(event.snapshot);

      if (snapshot === lastPublicSnapshot) {
        return false;
      }

      lastPublicSnapshot = snapshot;

      return true;
    }),
  );

  const forwarded = publicEvents.pipe(
    // Queue an upstream error after earlier writes.
    materialize(),
    concatMap(async (notification) => {
      if (notification.kind === "E") {
        throw notification.error instanceof Error
          ? notification.error
          : new Error("Agent stream failed");
      }

      if (notification.kind === "N") {
        await writeEvent(notification.value);
      }
    }),
    takeUntil(detached),
  );

  await lastValueFrom(forwarded, { defaultValue: undefined });
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
      const writer = createRunEventWriter(stream, trustedInput);

      stream.onAbort(() => {
        // Aegra continues the run and the browser can recover from persistence.
        detached.next();
        detached.complete();
      });

      try {
        const execution = createExecution(observation.runCreated);

        await forwardAgentEvents({
          events: execution.events,
          detached,
          runId: trustedInput.runId,
          writeEvent(event) {
            observation.event(event);

            return writer.writeEvent(event);
          },
        });

        // This callback reconciles checkpoints after forwarding stops.
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

        await writer.reportFailure();
      }
    }),
  );
}
