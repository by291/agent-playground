import {
  WebTracerProvider,
  BatchSpanProcessor,
} from "@opentelemetry/sdk-trace-web";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { reportClientError } from "./tracing";

export function initializeTracing() {
  const provider = new WebTracerProvider({
    resource: resourceFromAttributes({
      "service.name": "agent-playground-web",
    }),
    spanProcessors: [
      new BatchSpanProcessor(
        new OTLPTraceExporter({
          url: `${location.origin}/telemetry/v1/traces`,
        }),
        { maxQueueSize: 256, scheduledDelayMillis: 1000 },
      ),
    ],
  });
  provider.register({ propagator: new W3CTraceContextPropagator() });
  window.addEventListener("error", (event) => reportClientError(event.error));
  window.addEventListener("unhandledrejection", (event) =>
    reportClientError(event.reason),
  );
  window.addEventListener("pagehide", () => {
    void provider.forceFlush();
  });
}
