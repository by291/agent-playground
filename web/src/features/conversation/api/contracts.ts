import {
  InterruptSchema,
  MessageSchema,
  RunAgentInputSchema,
} from "@ag-ui/client";
import { z } from "zod";
import { externalTaskSnapshotSchema } from "@shared/external-task";
import { runStatuses } from "@shared/run-status";
import { contextUsageSchema } from "@shared/context-usage";
import { parseA2UIOutput } from "@/features/a2ui";
import { selectConversationModelSchema } from "@shared/conversation";

export const pendingSubmissionSchema = z.object({
  runId: z.string().min(1),
  messageId: z.string().min(1),
  submittedAt: z.string().optional(),
  messages: MessageSchema.array(),
  state: z.record(z.unknown()),
  modelId: selectConversationModelSchema.shape.modelId.optional(),
  resume: RunAgentInputSchema.shape.resume,
});

export type PendingSubmission = z.infer<typeof pendingSubmissionSchema>;

export const conversationSnapshotSchema = z.object({
  externalTasks: externalTaskSnapshotSchema.array().optional(),
  title: z.string().optional(),
  modelId: z.string().nullable().optional(),
  contextUsage: contextUsageSchema.nullable().optional(),
  messages: MessageSchema.array(),
  interrupts: InterruptSchema.array(),
  messageTimestamps: z.record(z.string()).optional(),
  outputs: z
    .unknown()
    .array()
    .transform((outputs) => outputs.map(parseA2UIOutput)),
  runs: z
    .object({
      runId: z.string().min(1),
      messageId: z.string().min(1).optional(),
      modelId: z.string().nullable().optional(),
      status: z.enum(runStatuses),
    })
    .array(),
});

export type ConversationSnapshot = z.infer<typeof conversationSnapshotSchema>;
