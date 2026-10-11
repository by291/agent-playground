import { z } from "zod";

import { maxFileBytes } from "./files.js";

export const maxKnowledgeBytes = maxFileBytes;
export const knowledgeTextEncodings = [
  { value: "utf-8", label: "UTF-8" },
  { value: "gb18030", label: "GB18030" },
  { value: "gbk", label: "GBK" },
  { value: "big5", label: "Big5" },
  { value: "utf-16-le", label: "UTF-16 LE" },
  { value: "utf-16-be", label: "UTF-16 BE" },
  { value: "utf-32-le", label: "UTF-32 LE" },
  { value: "utf-32-be", label: "UTF-32 BE" },
  { value: "cp1252", label: "Windows-1252" },
  { value: "shift_jis", label: "Shift JIS" },
] as const;
export const knowledgeTextEncodingSchema = z.enum([
  "utf-8",
  "gb18030",
  "gbk",
  "big5",
  "utf-16-le",
  "utf-16-be",
  "utf-32-le",
  "utf-32-be",
  "cp1252",
  "shift_jis",
]);
export type KnowledgeTextEncoding = z.infer<typeof knowledgeTextEncodingSchema>;

export const knowledgeDocumentSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  size: z.number().int().nonnegative(),
  status: z.enum(["uploading", "queued", "indexing", "ready", "failed"]),
  error: z.string().nullable(),
  textEncoding: knowledgeTextEncodingSchema.nullable().default(null),
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
