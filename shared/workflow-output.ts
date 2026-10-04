import { z } from "zod";

export const workflowOutputMetadataSchema = z
  .object({
    reply: z
      .object({ id: z.string().min(1), content: z.string().min(1) })
      .strict()
      .optional(),
    presentation: z
      .object({
        surfaceId: z.string().min(1),
        groupId: z.string().min(1),
        anchorMessageId: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type WorkflowOutputMetadata = z.infer<
  typeof workflowOutputMetadataSchema
>;

export function workflowMetadata(
  value: unknown,
): WorkflowOutputMetadata | undefined {
  const envelope = z
    .object({ workflow: workflowOutputMetadataSchema.optional() })
    .safeParse(value);

  if (!envelope.success) {
    return undefined;
  }

  return envelope.data.workflow;
}

export function workflowReplyMessages(value: unknown) {
  const reply = workflowMetadata(value)?.reply;

  return reply ? [{ ...reply, role: "assistant" as const }] : [];
}
