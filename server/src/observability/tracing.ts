import {
  context,
  propagation,
  trace,
  SpanStatusCode,
  type Span,
} from "@opentelemetry/api";

/** Traces server operations under the application service name. */
export const tracer = trace.getTracer("agent-playground-server");

/** Injects the active trace into headers or upstream run metadata. */
export function traceCarrier(): Record<string, string> {
  const carrier: Record<string, string> = {};

  propagation.inject(context.active(), carrier);

  return carrier;
}

/** Records an exception and marks its span as failed. */
export function recordError(span: Span, error: unknown) {
  const exception =
    error instanceof Error ? error : new Error("Operation failed");

  span.recordException(exception);
  span.setStatus({ code: SpanStatusCode.ERROR, message: exception.message });
}
