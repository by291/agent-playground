import assert from "node:assert/strict";
import test from "node:test";
import {
  WebTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-web";
import { startSubmissionTrace } from "./tracing";
import { propagation } from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";

void test("browser submission propagates its span and summarizes first text and failure", () => {
  const exporter = new InMemorySpanExporter();
  const provider = new WebTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  const operation = startSubmissionTrace(
    "thread",
    "run",
    provider.getTracer("test"),
  );
  assert.match(
    operation.headers.traceparent ?? "",
    /^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/,
  );
  operation.firstText();
  operation.firstText();
  operation.error(new Error("Controlled error"));
  operation.finish();
  operation.finish();
  const spans = exporter.getFinishedSpans();
  assert.equal(spans.length, 1);
  const span = spans[0];
  assert.equal(span?.attributes["langfuse.session.id"], "thread");
  assert.equal(span?.status.code, 2);
  assert.equal(
    span?.events.filter((event) => event.name === "first_text_received").length,
    1,
  );
  assert.equal(
    operation.headers.traceparent?.split("-")[1],
    span?.spanContext().traceId,
  );
  propagation.disable();
});
