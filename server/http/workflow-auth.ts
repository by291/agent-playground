import type { Env, MiddlewareHandler } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { HTTPException } from "hono/http-exception";

export function workflowAuth(message: string): MiddlewareHandler<Env> {
  return async (context, next) => {
    const token = process.env.WORKFLOW_API_TOKEN ?? "";

    if (!token) {
      return context.json({ error: message }, 401);
    }

    try {
      // Keep authentication separate from downstream exceptions, and preserve
      // the existing JSON/401 contract for missing or malformed credentials.
      await bearerAuth({ token })(context, () => Promise.resolve());
    } catch (error) {
      if (
        error instanceof HTTPException &&
        (error.status === 400 || error.status === 401)
      ) {
        return context.json({ error: message }, 401);
      }

      throw error;
    }

    await next();
  };
}
