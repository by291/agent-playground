import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  renameConversationSchema,
  selectConversationModelSchema,
} from "../../../shared/conversation.js";
import { synchronizeConversation } from "../conversation/runs/checkpoint-sync.js";
import { conversationSnapshot } from "../conversation/history/snapshot.js";
import { SubmissionError } from "../conversation/errors.js";
import {
  conversationExists,
  deleteAllConversations,
  deleteConversation,
  listConversations,
  parseConversationCursor,
  renameConversation,
} from "../conversation/history/management.js";
import { logger } from "../observability/logger.js";
import { streamConversationChanges } from "./conversation-events.js";
import { selectConversationModel } from "../conversation/runs/model-selection.js";

const maximumConversationRequestBytes = 4096;

/** Serves conversation management, recovery snapshots, and change notifications. */
export const conversationRoutes = new Hono();

conversationRoutes.patch(
  "/:threadId/model",
  bodyLimit({ maxSize: maximumConversationRequestBytes }),
  async (context) => {
    const body: unknown = await context.req.json().catch(() => null);
    const parsed = selectConversationModelSchema.safeParse(body);

    if (!parsed.success) {
      return context.json({ error: "Invalid conversation model" }, 400);
    }

    try {
      const selection = await selectConversationModel(
        context.req.param("threadId"),
        parsed.data.modelId,
      );

      return context.json(selection);
    } catch (error) {
      if (error instanceof SubmissionError) {
        return context.json({ error: error.message }, error.status);
      }

      logger.error({ err: error }, "Conversation model selection failed");

      return context.json(
        { error: "Conversation model selection is unavailable" },
        503,
      );
    }
  },
);

conversationRoutes.get("/", async (context) => {
  try {
    const cursor = parseConversationCursor(context.req.query("cursor"));

    const page = await listConversations(cursor);

    return context.json(page);
  } catch (error) {
    if (error instanceof SubmissionError) {
      return context.json({ error: error.message }, error.status);
    }

    logger.error({ err: error }, "Conversation listing failed");

    return context.json({ error: "Conversation listing is unavailable" }, 503);
  }
});

conversationRoutes.patch(
  "/:threadId",
  bodyLimit({ maxSize: maximumConversationRequestBytes }),
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
      const conversation = await renameConversation(
        context.req.param("threadId"),
        parsed.data.title,
      );

      return context.json(conversation);
    } catch (error) {
      if (error instanceof SubmissionError) {
        return context.json({ error: error.message }, error.status);
      }

      logger.error({ err: error }, "Conversation rename failed");

      return context.json({ error: "Conversation rename is unavailable" }, 503);
    }
  },
);

conversationRoutes.delete("/", async (context) => {
  try {
    await deleteAllConversations();

    return context.body(null, 204);
  } catch (error) {
    if (error instanceof SubmissionError) {
      return context.json({ error: error.message }, error.status);
    }

    logger.error({ err: error }, "Conversation clearing failed");

    return context.json({ error: "Conversation clearing is unavailable" }, 503);
  }
});

conversationRoutes.delete("/:threadId", async (context) => {
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

conversationRoutes.get("/:threadId", async (context) => {
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

conversationRoutes.get("/:threadId/events", async (context) => {
  const threadId = context.req.param("threadId");

  if (!(await conversationExists(threadId))) {
    return context.json({ error: "Conversation not found" }, 404);
  }

  return streamConversationChanges(context, threadId);
});
