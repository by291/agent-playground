import { z } from "zod";

import { filenameSchema, maxFileBytes } from "./files";

export const maxSkillFileBytes = maxFileBytes;
export const skillFilenameSchema = filenameSchema;
export const skillFileSchema = z.object({
  id: z.string().uuid(),
  threadId: z.string().min(1).max(256),
  name: skillFilenameSchema,
  size: z.number().int().min(0).max(maxSkillFileBytes),
});
export type SkillFile = z.infer<typeof skillFileSchema>;

export function skillFileUrl(file: Pick<SkillFile, "id" | "threadId">) {
  return `/conversations/${encodeURIComponent(file.threadId)}/files/${encodeURIComponent(file.id)}`;
}

export const skillScriptResultSchema = z.object({
  kind: z.literal("skill_script_result"),
  exitCode: z.number().int().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  error: z.string().nullable(),
  files: skillFileSchema.array().max(4),
});
