import {
  ROOT_CONTEXT,
  propagation,
  trace,
  SpanStatusCode,
  type Tracer,
} from "@opentelemetry/api";

export function startSubmissionTrace(
  threadId: string,
  runId: string,
  tracer: Tracer = trace.getTracer("agent-playground-web"),
) {
  const started = performance.now();
  const span = tracer.startSpan(
    "web.submit",
    {
      attributes: {
        "langfuse.trace.name": "agent.submit",
        "langfuse.session.id": threadId,
        "langfuse.trace.metadata.agui_run_id": runId,
      },
    },
    ROOT_CONTEXT,
  );
  const headers: Record<string, string> = {};

  propagation.inject(trace.setSpan(ROOT_CONTEXT, span), headers);
  let firstText = false;
  let finished = false;

  return {
    headers,

    firstText() {
      if (firstText || finished) {
        return;
      }

      firstText = true;
      const elapsed = performance.now() - started;

      span.setAttribute("app.first_text_received_ms", elapsed);
      span.addEvent("first_text_received", { duration_ms: elapsed });
    },

    event(name: string) {
      if (!finished) {
        span.addEvent(name);
      }
    },

    outcome(value: string) {
      span.setAttribute("app.stream.outcome", value);
    },

    error(error: unknown) {
      if (finished) {
        return;
      }

      const exception =
        error instanceof Error ? error : new Error("Client operation failed");

      span.recordException(exception);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: exception.message,
      });
    },

    finish() {
      if (finished) {
        return;
      }

      finished = true;
      span.end();
    },
  };
}

export function reportClientError(
  error: unknown,
  attributes: Record<string, string> = {},
) {
  const exception =
    error instanceof Error ? error : new Error("Client operation failed");
  const span = trace
    .getTracer("agent-playground-web")
    .startSpan("web.error", { attributes });

  span.recordException(exception);
  span.setStatus({ code: SpanStatusCode.ERROR, message: exception.message });
  span.end();
}
