import { knowledgeDocumentSchema } from "@shared/knowledge";

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

export async function listKnowledge(signal: AbortSignal) {
  const response = await knowledgeRequest("", { signal });

  return knowledgeDocumentSchema.array().parse(await response.json());
}
