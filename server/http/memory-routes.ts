import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { memoryEditSchema, memoryMutationSchema } from "../../shared/memory";
import {
  editMemory,
  forgetMemory,
  listMemories,
  MemoryServiceError,
} from "../memory/client";

const idSchema = z.string().uuid();
const pageSchema = z
  .object({
    offset: z
      .string()
      .regex(/^(0|[1-9]\d*)$/)
      .default("0")
      .transform(Number)
      .pipe(z.number().int().min(0).max(1_000_000)),
    limit: z
      .string()
      .regex(/^[1-9]\d*$/)
      .default("50")
      .transform(Number)
      .pipe(z.number().int().min(1).max(100)),
  })
  .strict();
const mutationBodyLimit = bodyLimit({
  maxSize: 16_384,
  onError: (context) =>
    context.json({ error: "Request body is too large" }, 413),
});

export const memoryRoutes = new Hono();

memoryRoutes.use("/api/memories", async (context, next) => {
  context.header("Cache-Control", "no-store");
  await next();
});
memoryRoutes.use("/api/memories/*", async (context, next) => {
  context.header("Cache-Control", "no-store");
  await next();
});
memoryRoutes.onError((error, context) => {
  if (error instanceof MemoryServiceError) {
    return context.json({ error: error.message }, error.status);
  }

  // Upstream bodies and exceptions can contain credentials or private URLs.
  return context.json({ error: "Memory service is unavailable" }, 503);
});

memoryRoutes.get("/api/memories", async (context) => {
  const query = context.req.queries();
  const repeatedField = Object.values(query).some(
    (values) => values.length !== 1,
  );
  const parsed = pageSchema.safeParse(context.req.query());

  if (repeatedField || !parsed.success) {
    return context.json({ error: "Invalid memory pagination" }, 400);
  }

  return context.json(
    await listMemories(
      parsed.data.offset,
      parsed.data.limit,
      context.req.raw.signal,
    ),
  );
});
memoryRoutes.patch("/api/memories/:id", mutationBodyLimit, async (context) => {
  const id = idSchema.safeParse(context.req.param("id"));
  const body: unknown = await context.req.json().catch(() => null);
  const edit = memoryEditSchema.safeParse(body);

  if (!id.success || !edit.success) {
    return context.json({ error: "Invalid memory edit" }, 400);
  }

  return context.json(
    await editMemory(id.data, edit.data, context.req.raw.signal),
  );
});
memoryRoutes.delete("/api/memories/:id", mutationBodyLimit, async (context) => {
  const id = idSchema.safeParse(context.req.param("id"));
  const body: unknown = await context.req.json().catch(() => null);
  const mutation = memoryMutationSchema.safeParse(body);

  if (!id.success || !mutation.success) {
    return context.json({ error: "Invalid memory deletion" }, 400);
  }

  await forgetMemory(id.data, mutation.data, context.req.raw.signal);

  return context.body(null, 204);
});
