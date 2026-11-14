import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createMiddleware } from "hono/factory";
import { z } from "zod";
import {
  memoryEditSchema,
  memoryMutationSchema,
} from "../../../shared/memory.js";
import {
  editMemory,
  forgetMemory,
  listMemories,
  MemoryServiceError,
} from "../memory/memory-client.js";

const maximumMemoryOffset = 1_000_000;
const defaultMemoryPageSize = 50;
const maximumMemoryPageSize = 100;
const maximumMemoryMutationBytes = 16_384;

const idSchema = z.string().uuid();
const offsetParameter = z
  .string()
  .regex(/^(0|[1-9]\d*)$/)
  .default("0");
const limitParameter = z
  .string()
  .regex(/^[1-9]\d*$/)
  .default(String(defaultMemoryPageSize));

const integer = z.number().int();
const pageSchema = z
  .object({
    offset: offsetParameter
      .transform(Number)
      .pipe(integer.min(0).max(maximumMemoryOffset)),
    limit: limitParameter
      .transform(Number)
      .pipe(integer.min(1).max(maximumMemoryPageSize)),
  })
  .strict();

const mutationBodyLimit = bodyLimit({
  maxSize: maximumMemoryMutationBytes,
  onError: (context) =>
    context.json({ error: "Request body is too large" }, 413),
});

const preventCaching = createMiddleware(async (context, next) => {
  context.header("Cache-Control", "no-store");

  await next();
});

/** Proxies public memory management requests to the private memory service. */
export const memoryRoutes = new Hono();

memoryRoutes.use("/api/memories", preventCaching);
memoryRoutes.use("/api/memories/*", preventCaching);

memoryRoutes.onError((error, context) => {
  if (error instanceof MemoryServiceError) {
    return context.json({ error: error.message }, error.status);
  }

  // Upstream bodies and exceptions can contain credentials or private URLs.
  return context.json({ error: "Memory service is unavailable" }, 503);
});

memoryRoutes.get("/api/memories", async (context) => {
  const query = context.req.queries();
  const hasRepeatedField = Object.values(query).some(
    (values) => values.length !== 1,
  );
  const parsed = pageSchema.safeParse(context.req.query());

  if (hasRepeatedField || !parsed.success) {
    return context.json({ error: "Invalid memory pagination" }, 400);
  }

  const page = await listMemories(
    parsed.data.offset,
    parsed.data.limit,
    context.req.raw.signal,
  );

  return context.json(page);
});

memoryRoutes.patch("/api/memories/:id", mutationBodyLimit, async (context) => {
  const id = idSchema.safeParse(context.req.param("id"));
  const body: unknown = await context.req.json().catch(() => null);
  const edit = memoryEditSchema.safeParse(body);

  if (!id.success || !edit.success) {
    return context.json({ error: "Invalid memory edit" }, 400);
  }

  const memory = await editMemory(id.data, edit.data, context.req.raw.signal);

  return context.json(memory);
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
