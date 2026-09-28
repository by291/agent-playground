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

export function prepareAegraRequest(url: URL, init: RequestInit): RequestInit {
  const carrier = traceCarrier();
  const headers = new Headers(init.headers);
  for (const [key, value] of Object.entries(carrier)) headers.set(key, value);
  const request = { ...init, headers };
  if (!url.pathname.endsWith("/runs/stream") || typeof init.body !== "string")
    return request;

  const body = JSON.parse(init.body) as {
    config?: { metadata?: Record<string, unknown> };
    metadata?: Record<string, unknown>;
  };
  const metadata = body.config?.metadata ?? {};
  // Runnable config is persisted by Aegra and reaches its per-run factory in the worker.
  body.config = {
    ...body.config,
    metadata: { ...metadata, otel_trace_context: carrier },
  };
  body.metadata = { ...body.metadata, agui_run_id: metadata.agui_run_id };
  return { ...request, body: JSON.stringify(body) };
}

export function recordError(span: Span, error: unknown) {
  const exception =
    error instanceof Error ? error : new Error("Operation failed");
  span.recordException(exception);
  span.setStatus({ code: SpanStatusCode.ERROR, message: exception.message });
}
