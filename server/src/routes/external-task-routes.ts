import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import {
  externalTaskRegistrationSchema,
  externalTaskUpdateSchema,
} from "../../../shared/external-task.js";
import { SubmissionError } from "../conversation/errors.js";
import {
  registerExternalTask,
  controlExternalTask,
  updateExternalTask,
} from "../conversation/tasks/task-store.js";
import { workflowAuth } from "../middleware/workflow-auth.js";

const maximumAdditionalInputCharacters = 4000;
const maximumControlRequestBytes = 16_384;

// Six bounded child outputs can use up to six JSON bytes per character.
const maximumTaskEventBytes = 4_000_000;

const boundedAdditionalInput = z.string().max(maximumAdditionalInputCharacters);
const invalidInputMessage = `Provide additional information up to ${maximumAdditionalInputCharacters} characters`;
const externalTaskInputSchema = z
  .object({ input: boundedAdditionalInput.trim().min(1) })
  .strict();

/** Serves external task control and workflow callbacks. */
export const externalTaskRoutes = new Hono();

externalTaskRoutes.post(
  "/external-tasks/:taskId/input",
  bodyLimit({ maxSize: maximumControlRequestBytes }),
  async (context) => {
    const body: unknown = await context.req.json().catch(() => null);
    const parsed = externalTaskInputSchema.safeParse(body);

    if (!parsed.success) {
      return context.json({ error: invalidInputMessage }, 400);
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
  bodyLimit({ maxSize: maximumControlRequestBytes }),
  async (context) => {
    const body: unknown = await context.req.json().catch(() => null);
    const parsed = externalTaskRegistrationSchema.safeParse(body);

    if (!parsed.success) {
      return context.json({ error: "Invalid external task registration" }, 400);
    }

    try {
      const task = await registerExternalTask(parsed.data);

      return context.json(task);
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
  bodyLimit({ maxSize: maximumTaskEventBytes }),
  async (context) => {
    const body: unknown = await context.req.json().catch(() => null);
    const parsed = externalTaskUpdateSchema.safeParse(body);

    if (!parsed.success) {
      return context.json({ error: "Invalid external task update" }, 400);
    }

    try {
      const taskId = context.req.param("taskId");
      const authorization = context.req.header("Authorization");
      const token = authorization?.replace(/^Bearer /, "") ?? "";

      const task = await updateExternalTask(taskId, token, parsed.data);

      return context.json(task);
    } catch (error) {
      if (error instanceof SubmissionError) {
        return context.json({ error: error.message }, error.status);
      }

      throw error;
    }
  },
);
