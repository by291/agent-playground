import { Client } from "@langchain/langgraph-sdk";
import { traceCarrier } from "../observability/tracing.js";

const maximumAegraRetries = 0;
const aegraTransport = new AbortController();

function retainLatestUserMessage(input: Record<string, unknown>) {
  const history = input.messages;

  if (!Array.isArray(history)) {
    return;
  }

  // The checkpoint owns model history; archived UI messages would undo compaction.
  const messages: unknown[] = history;
  const userMessage = messages
    .slice()
    .reverse()
    .find((message) => {
      if (message === null || typeof message !== "object") {
        return false;
      }

      const isHumanMessage = "type" in message && message.type === "human";
      const isUserMessage = "role" in message && message.role === "user";

      return isHumanMessage || isUserMessage;
    });

  input.messages = userMessage ? [userMessage] : [];
}

/** Propagates tracing and prepares inputs for Aegra's run API. */
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
  } else if (body.input && typeof body.input === "object") {
    const input = body.input as Record<string, unknown>;

    retainLatestUserMessage(input);
    delete input.context_usage;
    delete input.response_messages;
  }

  const metadata = body.config?.metadata ?? {};

  body.metadata = { ...body.metadata, agui_run_id: metadata.agui_run_id };

  // Runnable config reaches the per-run graph factory inside Aegra's worker.
  body.config = {
    ...body.config,
    metadata: { ...metadata, otel_trace_context: carrier },
  };

  return {
    ...init,
    headers,
    body: JSON.stringify(body),
  };
}

/** Disconnects outstanding SDK requests after the server drains dispatch receipts. */
export function closeAegraTransport(): void {
  aegraTransport.abort();
}

/** Base URL for private Aegra endpoints. */
export const aegraUrl = process.env.AEGRA_URL ?? "http://127.0.0.1:2026";

/** Shared SDK client for private Agent Protocol requests. */
export const aegra = new Client({
  apiUrl: aegraUrl,
  onRequest(url, init) {
    const prepared = prepareAegraRequest(url, init);
    // Preserve each caller's cancellation while allowing shutdown to close local sockets.
    const signal = prepared.signal
      ? AbortSignal.any([prepared.signal, aegraTransport.signal])
      : aegraTransport.signal;

    return { ...prepared, signal };
  },
  // A lost creation response may follow a committed run; recovery reconciles its ID.
  callerOptions: { maxRetries: maximumAegraRetries },
});
