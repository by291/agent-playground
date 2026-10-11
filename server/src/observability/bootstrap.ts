import {
  NodeTracerProvider,
  BatchSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import {
  AggregationType,
  InstrumentType,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { metrics } from "@opentelemetry/api";

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
let shutdownProviders: (() => Promise<void>) | undefined;
let shutdown: Promise<void> | undefined;

if (endpoint) {
  const resource = resourceFromAttributes({
    "service.name": "agent-playground-server",
    "deployment.environment.name": process.env.NODE_ENV ?? "development",
  });
  const provider = new NodeTracerProvider({
    resource,
    spanProcessors: [
      new BatchSpanProcessor(
        new OTLPTraceExporter({
          url: `${endpoint.replace(/\/$/, "")}/v1/traces`,
        }),
      ),
    ],
  });

  provider.register({ propagator: new W3CTraceContextPropagator() });

  const meterProvider = new MeterProvider({
    resource,
    views: [
      {
        instrumentType: InstrumentType.HISTOGRAM,
        instrumentUnit: "s",
        aggregation: {
          type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM,
          options: {
            boundaries: [
              0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120,
              300,
            ],
          },
        },
      },
    ],
    readers: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({
          url: `${endpoint.replace(/\/$/, "")}/v1/metrics`,
        }),
        exportIntervalMillis: 10_000,
      }),
    ],
  });

  metrics.setGlobalMeterProvider(meterProvider);

  shutdownProviders = async () => {
    const results = await Promise.allSettled([
      provider.shutdown(),
      meterProvider.shutdown(),
    ]);
    const failures = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason as unknown] : [],
    );

    if (failures.length) {
      throw new AggregateError(failures, "Telemetry shutdown failed");
    }
  };
}

export function shutdownTelemetry(): Promise<void> {
  // Both signal paths share one flush; providers must not be shut down twice.
  shutdown ??= shutdownProviders?.() ?? Promise.resolve();

  return shutdown;
}
