import { knowledgeDocumentSchema } from "@shared/knowledge";

/** Sends a document request and exposes server errors to the owning mutation. */
export async function knowledgeRequest(path = "", init?: RequestInit) {
  const response = await fetch(`/api/knowledge/documents${path}`, init);

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    throw new Error(
      body?.error ?? `Document request failed (${response.status})`,
    );
  }

  return response;
}

/** Reads and validates the document list for the query cache. */
export async function listKnowledge(signal: AbortSignal) {
  const response = await knowledgeRequest("", { signal });

  return knowledgeDocumentSchema.array().parse(await response.json());
}
