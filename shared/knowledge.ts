import { z } from "zod";

import { maxFileBytes } from "./files";

export const maxKnowledgeBytes = maxFileBytes;
export const knowledgeDocumentSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  size: z.number().int().nonnegative(),
  status: z.enum(["uploading", "queued", "indexing", "ready", "failed"]),
  error: z.string().nullable(),
  chunkCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type KnowledgeDocument = z.infer<typeof knowledgeDocumentSchema>;

export const knowledgeSearchSchema = z.object({
  kind: z.literal("knowledge_search_result"),
  query: z.string(),
  error: z.string().nullable(),
  sources: z.array(
    z.object({
      chunkId: z.string().uuid(),
      documentId: z.string().uuid(),
      name: z.string(),
      page: z.number().int().positive().nullable(),
      excerpt: z.string(),
      distance: z.number().finite(),
      citation: z.string().optional(),
    }),
  ),
});
export type KnowledgeSource = z.infer<
  typeof knowledgeSearchSchema
>["sources"][number];

export const knowledgeCitationUrl = (chunkId: string) =>
  `#knowledge-source-${chunkId}`;

export const knowledgeFileUrl = (id: string) =>
  `/api/knowledge/documents/${encodeURIComponent(id)}/file`;
