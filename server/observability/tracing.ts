import {
  context,
  propagation,
  trace,
  SpanStatusCode,
  type Span,
} from "@opentelemetry/api";

export const tracer = trace.getTracer("agent-playground-server");

export function traceCarrier(): Record<string, string> {
  const carrier: Record<string, string> = {};

  propagation.inject(context.active(), carrier);

  return carrier;
}

export function recordError(span: Span, error: unknown) {
  const exception =
    error instanceof Error ? error : new Error("Operation failed");

  span.recordException(exception);
  span.setStatus({ code: SpanStatusCode.ERROR, message: exception.message });
}
