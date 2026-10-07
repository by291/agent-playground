import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import {
  externalTaskRegistrationSchema,
  externalTaskUpdateSchema,
} from "../../shared/external-task";
import { SubmissionError } from "../conversation/errors";
import {
  registerExternalTask,
  controlExternalTask,
  updateExternalTask,
} from "../conversation/external-tasks";
import { workflowAuth } from "./workflow-auth";

export const externalTaskRoutes = new Hono();

const externalTaskInputSchema = z
  .object({ input: z.string().max(4000).trim().min(1) })
  .strict();

externalTaskRoutes.post(
  "/external-tasks/:taskId/input",
  bodyLimit({ maxSize: 16384 }),
  async (context) => {
    const parsed = externalTaskInputSchema.safeParse(
      await context.req.json().catch(() => null),
    );

    if (!parsed.success) {
      return context.json(
        { error: "Provide additional information up to 4000 characters" },
        400,
      );
    }

    try {
      return await controlExternalTask(
        context.req.param("taskId"),
        "input",
        parsed.data.input,
      );
    } catch (error) {
      if (error instanceof SubmissionError) {
        return context.json({ error: error.message }, error.status);
      }

      return context.json(
        { error: "Agent control is unavailable. Please retry." },
        502,
      );
    }
  },
);

externalTaskRoutes.post("/external-tasks/:taskId/cancel", async (context) => {
  try {
    return await controlExternalTask(context.req.param("taskId"), "cancel");
  } catch (error) {
    if (error instanceof SubmissionError) {
      return context.json({ error: error.message }, error.status);
    }

    return context.json(
      { error: "Agent control is unavailable. Please retry." },
      502,
    );
  }
});

externalTaskRoutes.post(
  "/internal/external-tasks",
  workflowAuth("Invalid workflow credential"),
  bodyLimit({ maxSize: 16384 }),
  async (context) => {
    const parsed = externalTaskRegistrationSchema.safeParse(
      await context.req.json().catch(() => null),
    );

    if (!parsed.success) {
      return context.json({ error: "Invalid external task registration" }, 400);
    }

    try {
      return context.json(await registerExternalTask(parsed.data));
    } catch (error) {
      if (error instanceof SubmissionError) {
        return context.json({ error: error.message }, error.status);
      }

      throw error;
    }
  },
);

externalTaskRoutes.post(
  "/external-tasks/:taskId/events",
  // Six bounded child outputs can use up to six JSON bytes per character.
  bodyLimit({ maxSize: 4000000 }),
  async (context) => {
    const parsed = externalTaskUpdateSchema.safeParse(
      await context.req.json().catch(() => null),
    );

    if (!parsed.success) {
      return context.json({ error: "Invalid external task update" }, 400);
    }

    try {
      return context.json(
        await updateExternalTask(
          context.req.param("taskId"),
          context.req.header("Authorization")?.replace(/^Bearer /, "") ?? "",
          parsed.data,
        ),
      );
    } catch (error) {
      if (error instanceof SubmissionError) {
        return context.json({ error: error.message }, error.status);
      }

      throw error;
    }
  },
);
