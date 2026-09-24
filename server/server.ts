import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { RunAgentInputSchema } from "@ag-ui/client";
import { LangGraphAgent } from "@ag-ui/langgraph";

const port = Number(process.env.PORT ?? 3000);
const aegraUrl = process.env.AEGRA_URL ?? "http://127.0.0.1:2026";

async function readBody(request: IncomingMessage): Promise<unknown> {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_000_000) throw new Error("Request body is too large");
  }
  return JSON.parse(body);
}

async function streamAgent(request: IncomingMessage, response: ServerResponse): Promise<void> {
  let input;
  try {
    input = RunAgentInputSchema.parse(await readBody(request));
  } catch {
    response.writeHead(400, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "Invalid AG-UI input" }));
    return;
  }

  // One adapter instance per request keeps its mutable run state isolated.
  const agent = new LangGraphAgent({ graphId: "agent", deploymentUrl: aegraUrl });
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    "x-accel-buffering": "no",
    connection: "keep-alive",
  });

  let lastSnapshot: string | undefined;
  const subscription = agent.run(input).subscribe({
    next(event) {
      if (event.type === "RAW") return;
      if (event.type === "STATE_SNAPSHOT") {
        const snapshot = JSON.stringify(event.snapshot);
        if (snapshot === lastSnapshot) return;
        lastSnapshot = snapshot;
      }
      const output = { ...event } as Record<string, unknown>;
      delete output.rawEvent;
      response.write(`data: ${JSON.stringify(output)}\n\n`);
    },
    error(error) {
      console.error("Agent stream failed", error);
      if (!response.writableEnded) {
        response.write(`data: ${JSON.stringify({ type: "RUN_ERROR", message: "Agent run failed" })}\n\n`);
        response.end();
      }
    },
    complete() {
      response.end();
    },
  });

  response.on("close", () => {
    if (!response.writableEnded) agent.abortRun();
    subscription.unsubscribe();
  });
}

createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (pathname === "/health") {
      response.writeHead(200).end("ok");
    } else if (pathname === "/agent" && request.method === "POST") {
      await streamAgent(request, response);
    } else {
      response.writeHead(404).end("Not found");
    }
  } catch (error) {
    console.error("Gateway request failed", error);
    if (!response.headersSent) response.writeHead(500).end("Internal server error");
    else response.end();
  }
}).listen(port, "0.0.0.0", () => {
  console.log(`AG-UI server listening on port ${port}`);
});
