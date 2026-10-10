import {
  memoryPageSchema,
  memorySchema,
  type MemoryEdit,
  type MemoryMutation,
} from "../../shared/memory";

export class MemoryServiceError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409 | 422 | 503,
  ) {
    super(message);
  }
}

function upstreamError(status: number, method: string) {
  if (method !== "GET") {
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
  }

  return new MemoryServiceError("Memory service is unavailable", 503);
}

async function requestMemory(
  suffix: string,
  method: "GET" | "PATCH" | "DELETE",
  signal: AbortSignal,
  body?: MemoryMutation | MemoryEdit,
) {
  const token = process.env.WORKFLOW_API_TOKEN ?? "";

  if (!token) {
    throw upstreamError(503, method);
  }

  const baseUrl = process.env.AEGRA_URL ?? "http://127.0.0.1:2026";
  const url = new URL(`${baseUrl.replace(/\/+$/, "")}/memory${suffix}`);
  const timeout = AbortSignal.timeout(5000);
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

export async function listMemories(
  offset: number,
  limit: number,
  signal: AbortSignal,
) {
  const response = await requestMemory(
    `?offset=${offset}&limit=${limit}`,
    "GET",
    signal,
  );
  const value: unknown = await response.json();

  return memoryPageSchema.parse(value);
}

export async function editMemory(
  id: string,
  edit: MemoryEdit,
  signal: AbortSignal,
) {
  const response = await requestMemory(`/${id}`, "PATCH", signal, edit);
  const value: unknown = await response.json();

  return memorySchema.parse(value);
}

export async function forgetMemory(
  id: string,
  mutation: MemoryMutation,
  signal: AbortSignal,
) {
  await requestMemory(`/${id}`, "DELETE", signal, mutation);
}
