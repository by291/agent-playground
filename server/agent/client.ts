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
  } else if (body.input && typeof body.input === "object") {
    const input = body.input as Record<string, unknown>;

    if (Array.isArray(input.messages)) {
      // The checkpoint owns model history; archived UI messages must not undo compaction.
      const userMessage: unknown = [...(input.messages as unknown[])]
        .reverse()
        .find(
          (message) =>
            message !== null &&
            typeof message === "object" &&
            (("type" in message && message.type === "human") ||
              ("role" in message && message.role === "user")),
        );

      input.messages = userMessage ? [userMessage] : [];
    }

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

  return { ...init, headers, body: JSON.stringify(body) };
}

export const aegraUrl = process.env.AEGRA_URL ?? "http://127.0.0.1:2026";
export const aegra = new Client({
  apiUrl: aegraUrl,
  onRequest: prepareAegraRequest,
  // A lost creation response may follow a committed run; recovery reconciles its ID.
  callerOptions: { maxRetries: 0 },
});
