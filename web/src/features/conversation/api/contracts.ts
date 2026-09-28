import {
  InterruptSchema,
  MessageSchema,
  RunAgentInputSchema,
} from "@ag-ui/client";
import { z } from "zod";
import { runStatuses } from "@shared/run-status";
import { contextUsageSchema } from "@shared/context-usage";
import { parseA2UIOutput } from "@/features/a2ui";

export const pendingSubmissionSchema = z.object({
  runId: z.string().min(1),
  messageId: z.string().min(1),
  messages: MessageSchema.array(),
  state: z.record(z.unknown()),
  resume: RunAgentInputSchema.shape.resume,
});

export type PendingSubmission = z.infer<typeof pendingSubmissionSchema>;

export const conversationSnapshotSchema = z.object({
  contextUsage: contextUsageSchema.nullable().optional(),
  messages: MessageSchema.array(),
  interrupts: InterruptSchema.array(),
  outputs: z
    .unknown()
    .array()
    .transform((outputs) => outputs.map(parseA2UIOutput)),
  runs: z
    .object({
      runId: z.string().min(1),
      messageId: z.string().min(1).optional(),
      status: z.enum(runStatuses),
    })
    .array(),
});

export type ConversationSnapshot = z.infer<typeof conversationSnapshotSchema>;
