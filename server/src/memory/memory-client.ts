import {
  memoryPageSchema,
  memorySchema,
  type MemoryEdit,
  type MemoryMutation,
} from "../../../shared/memory.js";

const memoryRequestTimeoutMs = 5000;

type MemoryMethod = "GET" | "PATCH" | "DELETE";

interface MemoryRequestOptions {
  suffix: string;
  method: MemoryMethod;
  signal: AbortSignal;
  body?: MemoryMutation | MemoryEdit;
}

/** Carries the HTTP status that the memory routes may return to clients. */
export class MemoryServiceError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409 | 422 | 503,
  ) {
    super(message);
  }
}

function upstreamError(status: number, method: MemoryMethod) {
  // Mutation statuses describe known conflicts clients may act on.
  if (method === "GET") {
    return new MemoryServiceError("Memory service is unavailable", 503);
  }

  if (status === 404) {
    return new MemoryServiceError("Memory was not found", 404);
  }

  if (status === 409) {
    return new MemoryServiceError(
      "Memory has changed. Refresh and try again.",
      409,
    );
  }

  if (status === 422) {
    return new MemoryServiceError("Invalid memory mutation", 422);
  }

  return new MemoryServiceError("Memory service is unavailable", 503);
}

async function requestMemory({
  suffix,
  method,
  signal,
  body,
}: MemoryRequestOptions) {
  const token = process.env.WORKFLOW_API_TOKEN ?? "";

  if (!token) {
    throw upstreamError(503, method);
  }

  const baseUrl = process.env.AEGRA_URL ?? "http://127.0.0.1:2026";
  const url = new URL(`${baseUrl.replace(/\/+$/, "")}/memory${suffix}`);
  const timeout = AbortSignal.timeout(memoryRequestTimeoutMs);

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.any([signal, timeout]),
    redirect: "error",
  });

  const expectedStatus = method === "DELETE" ? 204 : 200;

  if (response.status !== expectedStatus) {
    throw upstreamError(response.status, method);
  }

  return response;
}

/** Loads and validates one page from the private memory service. */
export async function listMemories(
  offset: number,
  limit: number,
  signal: AbortSignal,
) {
  const response = await requestMemory({
    suffix: `?offset=${offset}&limit=${limit}`,
    method: "GET",
    signal,
  });
  const value: unknown = await response.json();

  return memoryPageSchema.parse(value);
}

/** Applies a versioned edit and returns the validated saved memory. */
export async function editMemory(
  id: string,
  edit: MemoryEdit,
  signal: AbortSignal,
) {
  const response = await requestMemory({
    suffix: `/${id}`,
    method: "PATCH",
    signal,
    body: edit,
  });
  const value: unknown = await response.json();

  return memorySchema.parse(value);
}

/** Requests deletion of the specified memory version. */
export async function forgetMemory(
  id: string,
  mutation: MemoryMutation,
  signal: AbortSignal,
) {
  await requestMemory({
    suffix: `/${id}`,
    method: "DELETE",
    signal,
    body: mutation,
  });
}
