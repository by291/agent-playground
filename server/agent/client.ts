import { Client } from "@langchain/langgraph-sdk";
import { traceCarrier } from "../observability/tracing";

export function prepareAegraRequest(url: URL, init: RequestInit): RequestInit {
  const carrier = traceCarrier();
  const headers = new Headers(init.headers);

  for (const [key, value] of Object.entries(carrier)) {
    headers.set(key, value);
  }

  if (!url.pathname.endsWith("/runs/stream") || typeof init.body !== "string") {
    return { ...init, headers };
  }

  const body = JSON.parse(init.body) as {
    input?: unknown;
    command?: unknown;
    config?: { metadata?: Record<string, unknown> };
    metadata?: Record<string, unknown>;
  };

  // Aegra rejects a resume command accompanied by the adapter's state input.
  if (body.command != null) {
    delete body.input;
  }

  const metadata = body.config?.metadata ?? {};

  body.metadata = { ...body.metadata, agui_run_id: metadata.agui_run_id };
  // Runnable config reaches the per-run graph factory inside Aegra's worker.
  body.config = {
    ...body.config,
    metadata: { ...metadata, otel_trace_context: carrier },
  };

  return { ...init, headers, body: JSON.stringify(body) };
}

export const aegraUrl = process.env.AEGRA_URL ?? "http://127.0.0.1:2026";
export const aegra = new Client({
  apiUrl: aegraUrl,
  onRequest: prepareAegraRequest,
});
