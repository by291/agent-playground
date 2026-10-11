import {
  memoryEditSchema,
  memoryMutationSchema,
  memoryPageSchema,
  memorySchema,
  type Memory,
} from "@shared/memory";

export class MemoryRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "MemoryRequestError";
  }
}

async function memoryRequest(path: string, init: RequestInit) {
  const response = await fetch(`/api/memories${path}`, init);

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: unknown;
    } | null;
    const message =
      typeof body?.error === "string"
        ? body.error.slice(0, 300)
        : `Memory request failed (${response.status})`;

    throw new MemoryRequestError(message, response.status);
  }

  return response;
}

export async function listMemories(offset: number, signal: AbortSignal) {
  const response = await memoryRequest(`?offset=${offset}&limit=50`, {
    signal,
  });

  return memoryPageSchema.parse(await response.json());
}

export async function correctMemory(
  memory: Memory,
  text: string,
  signal: AbortSignal,
) {
  const body = memoryEditSchema.parse({
    category: memory.category,
    project: memory.project,
    revision: memory.revision,
    text,
  });
  const response = await memoryRequest(`/${memory.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  return memorySchema.parse(await response.json());
}

export async function forgetMemory(memory: Memory, signal: AbortSignal) {
  const body = memoryMutationSchema.parse({
    category: memory.category,
    project: memory.project,
    revision: memory.revision,
  });

  await memoryRequest(`/${memory.id}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}
