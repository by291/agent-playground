import { test } from "vitest";
import assert from "node:assert/strict";
import { context, trace } from "@opentelemetry/api";
import {
  NodeTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { overrideFetchImplementation } from "@langchain/langgraph-sdk";
import { aegra, prepareAegraRequest } from "./client";

test("a run accepted before its response disconnects is submitted only once", async () => {
  const requests: { method: string | undefined; pathname: string }[] = [];

  overrideFetchImplementation((url: string, init: RequestInit) => {
    requests.push({ method: init.method, pathname: new URL(url).pathname });

    if (requests.length === 1) {
      // The upstream write committed, but the response headers never arrived.
      return Promise.reject(
        new Error("Socket disconnected after upstream acceptance"),
      );
    }

    return Promise.resolve(
      new Response("event: end\ndata: {}\n\n", {
        headers: { "Content-Type": "text/event-stream" },
      }),
    );
  });

  try {
    await assert.rejects(async () => {
      for await (const event of aegra.runs.stream("thread", "agent", {
        input: { messages: [{ role: "user", content: "Create report" }] },
      })) {
        assert.ok(event);
      }
    }, /Socket disconnected/);
    assert.deepEqual(requests, [
      { method: "POST", pathname: "/threads/thread/runs/stream" },
    ]);
  } finally {
    overrideFetchImplementation(globalThis.fetch);
  }
});

test("continuation sends only the newest user turn and never restores compacted state", () => {
  const init = prepareAegraRequest(
    new URL("http://aegra/threads/thread/runs/stream"),
    {
      method: "POST",
      body: JSON.stringify({
        input: {
          messages: [
            { id: "old", type: "human", content: "Old history" },
            { id: "reply", type: "ai", content: "Old reply" },
            { id: "new", type: "human", content: "Continue" },
          ],
          context_usage: { compactions: 0 },
          response_messages: [],
          selected: "kept",
        },
      }),
    },
  );
  const body = JSON.parse(init.body as string) as { input: unknown };

  assert.deepEqual(body.input, {
    messages: [{ id: "new", type: "human", content: "Continue" }],
    selected: "kept",
  });
});

test("Aegra submission persists the active server span, preserves resume and metadata", async () => {
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
