import assert from "node:assert/strict";
import test from "node:test";
import { context, trace } from "@opentelemetry/api";
import {
  NodeTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { prepareAegraRequest } from "./tracing";

void test("Aegra submission persists the active server span, preserves resume and metadata", async () => {
  const exporter = new InMemorySpanExporter();
  const provider = new NodeTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  provider.register({ propagator: new W3CTraceContextPropagator() });
  try {
    trace.getTracer("test").startActiveSpan("server.agent", (span) => {
      const init = prepareAegraRequest(
        new URL("http://aegra/threads/thread/runs/stream"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            command: { resume: "approved" },
            config: { metadata: { agui_run_id: "submit" } },
            metadata: { source: "test" },
          }),
        },
      );
      assert.equal(typeof init.body, "string");
      const body = JSON.parse(init.body as string) as {
        config: { metadata: { otel_trace_context: { traceparent: string } } };
        metadata: Record<string, unknown>;
      };
      const carrier = body.config.metadata.otel_trace_context;
      const restored = new W3CTraceContextPropagator().extract(
        context.active(),
        carrier,
        {
          keys: Object.keys,
          get: (value: Record<string, string>, key: string) => value[key],
        },
      );
      assert.equal(
        trace.getSpanContext(restored)?.traceId,
        span.spanContext().traceId,
      );
      assert.equal(
        trace.getSpanContext(restored)?.spanId,
        span.spanContext().spanId,
      );
      assert.equal(trace.getSpanContext(restored)?.isRemote, true);
      assert.equal(
        new Headers(init.headers).get("traceparent"),
        carrier.traceparent,
      );
      assert.equal(body.metadata.agui_run_id, "submit");
      assert.equal(body.metadata.source, "test");
      span.end();
    });
    const plain = prepareAegraRequest(
      new URL("http://aegra/threads/thread/runs"),
      { method: "GET" },
    );
    assert.equal(plain.body, undefined);
  } finally {
    await provider.shutdown();
    trace.disable();
    context.disable();
  }
});
