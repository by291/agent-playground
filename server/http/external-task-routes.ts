import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  externalTaskRegistrationSchema,
  externalTaskUpdateSchema,
} from "../../shared/external-task";
import { SubmissionError } from "../conversation/errors";
import {
  registerExternalTask,
  updateExternalTask,
} from "../conversation/external-tasks";

export const externalTaskRoutes = new Hono();

externalTaskRoutes.post(
  "/internal/external-tasks",
  bodyLimit({ maxSize: 16384 }),
  async (context) => {
    const expected = Buffer.from(process.env.WORKFLOW_API_TOKEN ?? "");
    const supplied = Buffer.from(
      context.req.header("Authorization")?.replace(/^Bearer /, "") ?? "",
    );

    if (
      !expected.length ||
      expected.length !== supplied.length ||
      !timingSafeEqual(expected, supplied)
    ) {
      return context.json({ error: "Invalid workflow credential" }, 401);
    }

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
  bodyLimit({ maxSize: 1000000 }),
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
