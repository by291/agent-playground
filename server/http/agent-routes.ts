import { RunAgentInputSchema } from "@ag-ui/client";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { streamAgent } from "../agent/agent-stream";
import { fetchAgentInfo } from "../agent/info";
import { SubmissionError } from "../conversation/errors";
import {
  executeConversationRun,
  prepareConversationRun,
} from "../conversation/service";
import { observeRequest } from "../observability/http";
import { logger } from "../observability/logger";

export const agentRoutes = new Hono();
agentRoutes.use("/agent", observeRequest);

agentRoutes.get("/agent-info", async (context) => {
  try {
    return context.json(await fetchAgentInfo());
  } catch {
    return context.json({ error: "Agent metadata is unavailable" }, 503);
  }
});

agentRoutes.post(
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
