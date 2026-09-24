import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { EventType, type BaseEvent } from "@ag-ui/core";
import { EventEncoder } from "@ag-ui/encoder";
import { parseAgentInput } from "./input.js";
import type { AgentRuntime } from "./runtime.js";

const maxBodyBytes = 1024 * 1024;

export function createHttpServer(runtime: AgentRuntime) {
  const activeThreads = new Set<string>();

  return createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      sendJson(response, 200, { status: "ok" });
      return;
    }
    if (request.method !== "POST" || request.url !== "/agent") {
      sendJson(response, 404, { error: "Not found." });
      return;
    }

    let input;
    try {
      input = parseAgentInput(await readJson(request));
    } catch (error) {
      const status = error instanceof RequestError ? error.status : 400;
      sendJson(response, status, { error: errorMessage(error) });
      return;
    }

    if (activeThreads.has(input.threadId)) {
      sendJson(response, 409, { error: "A run is already active for this thread." });
      return;
    }
    activeThreads.add(input.threadId);

    const abort = new AbortController();
    response.on("close", () => abort.abort());
    const encoder = new EventEncoder({ accept: "text/event-stream" });
    response.writeHead(200, {
      "Content-Type": encoder.getContentType(),
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    response.flushHeaders();

    const emit = (event: BaseEvent) => {
      if (!response.destroyed) response.write(encoder.encode(event));
    };

    try {
      emit({ type: EventType.RUN_STARTED, threadId: input.threadId, runId: input.runId });
      await runtime.run(input, emit, abort.signal);
      if (!abort.signal.aborted) {
        emit({ type: EventType.RUN_FINISHED, threadId: input.threadId, runId: input.runId });
      }
    } catch (error) {
      if (!abort.signal.aborted) {
        emit({ type: EventType.RUN_ERROR, message: errorMessage(error) });
      }
    } finally {
      activeThreads.delete(input.threadId);
      response.end();
    }
  });
}

class RequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  let body = "";
  for await (const chunk of request) {
    body += chunk.toString();
    if (Buffer.byteLength(body) > maxBodyBytes) {
      throw new RequestError("Request body is too large.", 413);
    }
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new RequestError("Request body must be valid JSON.", 400);
  }
}

function sendJson(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error.";
}
