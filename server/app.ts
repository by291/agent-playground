import { RunAgentInputSchema } from "@ag-ui/client";
import { Hono } from "hono";
import { desc } from "drizzle-orm";
import { bodyLimit } from "hono/body-limit";
import { streamAgent } from "./agent/agent-stream";
import { conversationSnapshot } from "./conversation/conversation-snapshot";
import {
  currentInterrupts,
  reviewCallsPersisted,
} from "./conversation/recovery";
import { admitRun, claimPrepared } from "./conversation/run-store";
import { db } from "./db/database";
import { conversations } from "./db/schema";

export const app = new Hono();

app.get("/health", (context) => context.text("ok"));

app.get("/conversations", async (context) => {
  const rows = await db
    .select({ threadId: conversations.threadId })
    .from(conversations)
    .orderBy(desc(conversations.createdAt))
    .limit(50);
  return context.json({ conversations: rows });
});

app.get("/conversations/:threadId", async (context) => {
  try {
    const snapshot = await conversationSnapshot(context.req.param("threadId"));
    return snapshot
      ? context.json(snapshot)
      : context.json({ error: "Conversation not found" }, 404);
  } catch (error) {
    console.error("Conversation recovery failed", error);
    return context.json({ error: "Conversation recovery failed" }, 503);
  }
});

async function waitForInterrupts(threadId: string) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const interrupts = await currentInterrupts(threadId);
      if (interrupts.length) return interrupts;
    } catch {
      // The checkpoint may still be committing after an interrupt event.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return [];
}

app.post(
  "/agent",
  bodyLimit({
    maxSize: 1_000_000,
    onError: (context) =>
      context.json({ error: "Request body is too large" }, 413),
  }),
  async (context) => {
    const body: unknown = await context.req.json().catch(() => null);
    const input = RunAgentInputSchema.safeParse(body);
    if (!input.success)
      return context.json({ error: "Invalid AG-UI input" }, 400);

    // Client-provided forwarding options cannot select Aegra metadata or disconnect policy.
    const trustedInput = { ...input.data };
    delete trustedInput.forwardedProps;
    const isResume = (trustedInput.resume?.length ?? 0) > 0;
    const userMessage = isResume
      ? null
      : [...trustedInput.messages]
          .reverse()
          .find((message) => message.role === "user");
    const messageId = isResume ? trustedInput.runId : userMessage?.id;
    if (!messageId || (!isResume && !userMessage)) {
      return context.json({ error: "Submission needs a user message" }, 400);
    }

    if (isResume) {
      const current = await waitForInterrupts(trustedInput.threadId);
      const submitted = trustedInput.resume ?? [];
      const currentIds = new Set(current.map((interrupt) => interrupt.id));
      const submittedIds = new Set(submitted.map((entry) => entry.interruptId));
      if (
        current.length !== submitted.length ||
        currentIds.size !== submittedIds.size ||
        [...currentIds].some((id) => !submittedIds.has(id)) ||
        !(await reviewCallsPersisted(trustedInput.threadId, current))
      ) {
        return context.json({ error: "Review is no longer current" }, 409);
      }
    }

    let admitted;
    try {
      // Refresh terminal status before admission so a completed run frees its thread.
      await conversationSnapshot(trustedInput.threadId);
      admitted = await admitRun({
        threadId: trustedInput.threadId,
        runId: trustedInput.runId,
        messageId,
        request: trustedInput,
        userMessage: userMessage ?? null,
        isResume,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Submission failed";
      return context.json({ error: message }, 409);
    }

    if (!(await claimPrepared(trustedInput.runId))) {
      return context.json(
        { error: "Submission already dispatched", status: admitted.row.status },
        409,
      );
    }

    return streamAgent(context, trustedInput, admitted.row);
  },
);
