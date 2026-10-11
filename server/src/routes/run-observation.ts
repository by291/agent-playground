import {
  EventType,
  type RunAgentInput,
  type RunFinishedEvent,
} from "@ag-ui/client";
import { metrics } from "@opentelemetry/api";
import type { SSEStreamingApi } from "hono/streaming";
import { tracer, recordError } from "../observability/tracing.js";

const meter = metrics.getMeter("agent-playground-server");
const duration = meter.createHistogram("app.stream.duration", { unit: "s" });
const connections = meter.createCounter("app.stream.connections");

interface StreamObservation {
  runCreated: (id: string) => void;
  event: (event: Record<string, unknown>) => void;
  failed: (error: unknown) => void;
}

export function observeAgentStream(
  input: Pick<RunAgentInput, "threadId" | "runId">,
  execute: (
    stream: SSEStreamingApi,
    observation: StreamObservation,
  ) => Promise<void>,
) {
  return (stream: SSEStreamingApi) =>
    tracer.startActiveSpan(
      "server.agent",
      {
        attributes: {
          "langfuse.trace.name": "agent.submit",
          "langfuse.session.id": input.threadId,
          "langfuse.trace.metadata.agui_run_id": input.runId,
        },
      },
      async (span) => {
        const started = performance.now();
        let outcome = "unknown";
        let firstText = false;

        stream.onAbort(() => {
          outcome = "disconnected";
        });

        try {
          await execute(stream, {
            runCreated: (id) => {
              span.setAttribute("langfuse.trace.metadata.aegra_run_id", id);
            },

            event(event) {
              if (
                event.type === EventType.TEXT_MESSAGE_CONTENT &&
                typeof event.delta === "string" &&
                event.delta.length &&
                !firstText
              ) {
                firstText = true;
                span.addEvent("first_text_forwarded", {
                  duration_ms: performance.now() - started,
                });
              }

              if (event.type === EventType.RUN_ERROR) {
                outcome = "error";
                recordError(span, new Error(String(event.message)));
              }

              if (event.type === EventType.RUN_FINISHED) {
                const finished = event as unknown as RunFinishedEvent;

                outcome =
                  finished.outcome?.type === "interrupt"
                    ? "interrupted"
                    : "finished";
              }
            },

            failed(error) {
              outcome = "error";
              recordError(span, error);
            },
          });
        } finally {
          span.setAttribute("app.stream.outcome", outcome);
          duration.record((performance.now() - started) / 1000, { outcome });
          connections.add(1, { outcome });
          span.end();
        }
      },
    );
}
