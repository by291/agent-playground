import { z } from "zod";

export const maxSkillFileBytes = 10 * 1024 * 1024;
export const skillFilenameSchema = z
  .string()
  .min(1)
  .max(200)
  .refine(
    (name) =>
      name !== "." && name !== ".." && !/[\\/\u0000-\u001f\u007f]/.test(name),
    "Use a filename without separators or control characters",
  );
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
