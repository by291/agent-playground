import {
  context as otelContext,
  propagation,
  trace,
  SpanKind,
  metrics,
} from "@opentelemetry/api";
import { createMiddleware } from "hono/factory";
import { routePath } from "hono/route";
import { tracer, recordError } from "../observability/tracing.js";
import { logger } from "../observability/logger.js";

const millisecondsPerSecond = 1000;

const duration = metrics
  .getMeter("agent-playground-server")
  .createHistogram("http.server.response.duration", { unit: "s" });

/** Traces request handling and records HTTP response status and duration. */
export const observeRequest = createMiddleware(async (context, next) => {
  const started = performance.now();
  const parent = propagation.extract(
    otelContext.active(),
    context.req.header(),
  );
  const span = tracer.startSpan(
    `${context.req.method} ${routePath(context)}`,
    { kind: SpanKind.SERVER },
    parent,
  );

  context.header("X-Trace-Id", span.spanContext().traceId);

  await otelContext.with(trace.setSpan(parent, span), async () => {
    try {
      await next();
      span.setAttribute("http.response.status_code", context.res.status);

      if (context.res.status >= 500) {
        recordError(span, context.error);
      }
    } catch (error) {
      recordError(span, error);
      logger.error({ err: error }, "HTTP request failed");
      throw error;
    } finally {
      const attributes = {
        "http.request.method": context.req.method,
        "http.route": routePath(context),
        "http.response.status_code": context.res.status,
      };

      span.setAttributes(attributes);

      // This measures response setup; the SSE span measures the connection lifetime.
      duration.record(
        (performance.now() - started) / millisecondsPerSecond,
        attributes,
      );
      span.end();
    }
  });
});
