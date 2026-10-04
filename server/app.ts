import { RunAgentInputSchema } from "@ag-ui/client";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { streamAgent } from "./agent/agent-stream";
import { fetchAgentInfo } from "./agent/info";
import { conversationSnapshot } from "./conversation/conversation-snapshot";
import {
  conversationExists,
  deleteConversation,
  listConversations,
  parseConversationCursor,
  renameConversation,
} from "./conversation/management";
import { renameConversationSchema } from "../shared/conversation";
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

app.get("/agent-info", async (context) => {
  try {
    return context.json(await fetchAgentInfo());
  } catch {
    return context.json({ error: "Agent metadata is unavailable" }, 503);
  }
});

app.get("/conversations", async (context) => {
  try {
    const cursor = parseConversationCursor(context.req.query("cursor"));

    return context.json(await listConversations(cursor));
  } catch (error) {
    if (error instanceof SubmissionError) {
      return context.json({ error: error.message }, error.status);
    }

    logger.error({ err: error }, "Conversation listing failed");

    return context.json({ error: "Conversation listing is unavailable" }, 503);
  }
});

app.patch(
  "/conversations/:threadId",
  bodyLimit({ maxSize: 4096 }),
  async (context) => {
    const body: unknown = await context.req.json().catch(() => null);
    const parsed = renameConversationSchema.safeParse(body);

    if (!parsed.success) {
      return context.json(
        { error: "Title must contain 1 to 100 characters" },
        400,
      );
    }

    try {
      return context.json(
        await renameConversation(
          context.req.param("threadId"),
          parsed.data.title,
        ),
      );
    } catch (error) {
      if (error instanceof SubmissionError) {
        return context.json({ error: error.message }, error.status);
      }

      logger.error({ err: error }, "Conversation rename failed");

      return context.json({ error: "Conversation rename is unavailable" }, 503);
    }
  },
);

app.delete("/conversations/:threadId", async (context) => {
  try {
    await deleteConversation(context.req.param("threadId"));

    return context.body(null, 204);
  } catch (error) {
    if (error instanceof SubmissionError) {
      return context.json({ error: error.message }, error.status);
    }

    logger.error({ err: error }, "Conversation deletion failed");

    return context.json({ error: "Conversation deletion is unavailable" }, 503);
  }
});

app.get("/conversations/:threadId", async (context) => {
  const threadId = context.req.param("threadId");

  try {
    if (!(await conversationExists(threadId))) {
      return context.json({ error: "Conversation not found" }, 404);
    }

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
