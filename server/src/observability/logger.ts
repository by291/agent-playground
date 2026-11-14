import pino from "pino";
import { trace } from "@opentelemetry/api";

/** Adds active trace and span identifiers to server logs. */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "agent-playground-server" },

  mixin() {
    const span = trace.getActiveSpan()?.spanContext();

    return span ? { trace_id: span.traceId, span_id: span.spanId } : {};
  },
});
