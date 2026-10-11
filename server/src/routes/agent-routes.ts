import { RunAgentInputSchema } from "@ag-ui/client";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { streamAgent } from "./run-stream.js";
import { fetchAgentInfo } from "../agent/agent-info.js";
import { SubmissionError } from "../conversation/errors.js";
import {
  executeConversationRun,
  prepareConversationRun,
  type PreparedConversationRun,
} from "../conversation/runs/run-dispatch.js";
import { observeRequest } from "../middleware/request-observation.js";
import { logger } from "../observability/logger.js";

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

    let prepared: PreparedConversationRun | undefined;

    try {
      prepared = await prepareConversationRun(parsed.data);

      const submission = prepared;

      return streamAgent(context, submission.input, (onRunCreated) =>
        executeConversationRun(submission, onRunCreated),
      );
    } catch (error) {
      // Streaming setup may throw before the producer takes responsibility for this claim.
      prepared?.releaseDispatch();

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
