import { RunAgentInputSchema } from "@ag-ui/client";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { streamAgent } from "./agent/agent-stream";
import {
  conversationSnapshot,
  listConversations,
} from "./conversation/conversation-snapshot";
import { synchronizeConversation } from "./conversation/checkpoint-sync";
import {
  executeConversationRun,
  prepareConversationRun,
} from "./conversation/service";
import { SubmissionError } from "./conversation/errors";
import { observeRequest } from "./observability/http";
import { telemetry } from "./observability/ingestion";
import { logger } from "./observability/logger";

export const app = new Hono();
app.route("/telemetry", telemetry);
app.use("/agent", observeRequest);
app.get("/health", (context) => context.text("ok"));

app.get("/conversations", async (context) => {
  return context.json({ conversations: await listConversations() });
});

app.get("/conversations/:threadId", async (context) => {
  const threadId = context.req.param("threadId");

  try {
    await synchronizeConversation(threadId);
    const snapshot = await conversationSnapshot(threadId);

    return snapshot
      ? context.json(snapshot)
      : context.json({ error: "Conversation not found" }, 404);
  } catch (error) {
    logger.error(
      { err: error, thread_id: threadId },
      "Conversation recovery failed",
    );

    return context.json({ error: "Conversation recovery failed" }, 503);
  }
});

app.post(
  "/agent",
  bodyLimit({
    maxSize: 1_000_000,
    onError: (context) =>
      context.json({ error: "Request body is too large" }, 413),
  }),
  async (context) => {
    const body: unknown = await context.req.json().catch(() => null);
    const parsed = RunAgentInputSchema.safeParse(body);

    if (!parsed.success) {
      return context.json({ error: "Invalid AG-UI input" }, 400);
    }

    try {
      const input = await prepareConversationRun(parsed.data);

      return streamAgent(context, input, (onRunCreated) =>
        executeConversationRun(input, onRunCreated),
      );
    } catch (error) {
      if (error instanceof SubmissionError) {
        return context.json({ error: error.message }, error.status);
      }

      logger.error(
        { err: error, thread_id: parsed.data.threadId },
        "Submission unavailable",
      );

      return context.json({ error: "Submission is unavailable" }, 503);
    }
  },
);
