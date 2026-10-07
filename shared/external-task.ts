import { z } from "zod";
import { runStatuses } from "./run-status";

const externalTaskStatusSchema = z.enum([
  "queued",
  "running",
  "input_required",
  "succeeded",
  "failed",
  "cancelled",
]);
const externalTaskOutputsSchema = z
  .array(
    z
      .object({
        agent: z.string().min(1).max(200),
        step: z.string().min(1).max(200),
        taskId: z.string().min(1).max(200),
        contextId: z.string().min(1).max(200),
        status: externalTaskStatusSchema,
        text: z.string().max(100000),
      })
      .strict(),
  )
  .max(6);

export const externalTaskUpdateSchema = z
  .object({
    revision: z.number().int().positive(),
    status: externalTaskStatusSchema,
    kind: z.literal("a2a").optional(),
    outputs: externalTaskOutputsSchema.optional(),
    stage: z.string().min(1).max(100),
    message: z.string().min(1).max(2000),
    progress: z.number().min(0).max(100).optional(),
    result: z.record(z.unknown()).optional(),
    error: z.string().min(1).max(2000).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === "succeeded" && !value.result) {
      context.addIssue({
        code: "custom",
        message: "A successful task requires a result",
      });
    }
    if (value.status === "failed" && !value.error) {
      context.addIssue({
        code: "custom",
        message: "A failed task requires an error",
      });
    }
  });
export type ExternalTaskUpdate = z.infer<typeof externalTaskUpdateSchema>;

export const externalTaskRegistrationSchema = z
  .object({
    taskId: z.string().min(1).max(200),
    threadId: z.string().min(1),
    workflowCallId: z.string().min(1),
    stepId: z.string().min(1).max(200),
    runId: z.string().min(1),
    label: z.string().min(1).max(200),
  })
  .strict();
export type ExternalTaskRegistration = z.infer<
  typeof externalTaskRegistrationSchema
>;

export const externalTaskSnapshotSchema = z.object({
  taskId: z.string(),
  workflowCallId: z.string(),
  label: z.string(),
  revision: z.number().int().nonnegative(),
  status: externalTaskStatusSchema,
  kind: z.literal("a2a").optional(),
  outputs: externalTaskOutputsSchema.optional(),
  stage: z.string(),
  message: z.string(),
  progress: z.number().optional(),
  error: z.string().optional(),
  history: externalTaskUpdateSchema.array(),
  continuationStatus: z.enum(runStatuses).nullable(),
});
export type ExternalTaskSnapshot = z.infer<typeof externalTaskSnapshotSchema>;

export function parseExternalWait(interrupt: {
  id: string;
  metadata?: unknown;
}) {
  const parsed = z
    .object({
      langgraph: z.object({
        raw: z.object({
          kind: z.literal("workflow_external_wait"),
          taskId: z.string().min(1),
          workflowCallId: z.string().min(1),
        }),
      }),
    })
    .safeParse(interrupt.metadata);

  return parsed.success
    ? { ...parsed.data.langgraph.raw, interruptId: interrupt.id }
    : null;
}

export function isExternalTaskTerminal(status: ExternalTaskUpdate["status"]) {
  return (
    status === "succeeded" || status === "failed" || status === "cancelled"
  );
}
