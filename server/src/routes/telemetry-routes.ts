import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

const maximumTraceRequestBytes = 256_000;
const traceForwardTimeoutMs = 3000;

/** Forwards browser traces to the configured OTLP receiver. */
export const telemetry = new Hono();

telemetry.post(
  "/v1/traces",
  bodyLimit({ maxSize: maximumTraceRequestBytes }),
  async (context) => {
    const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

    if (!endpoint) {
      return context.body(null, 204);
    }

    try {
      const response = await fetch(`${endpoint.replace(/\/$/, "")}/v1/traces`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: await context.req.text(),
        signal: AbortSignal.timeout(traceForwardTimeoutMs),
      });

      return context.body(null, response.ok ? 200 : 503);
    } catch {
      return context.body(null, 503);
    }
  },
);
