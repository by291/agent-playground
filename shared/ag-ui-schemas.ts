import type {
  Interrupt,
  Message,
  ResumeEntry,
  RunAgentInput,
} from "@ag-ui/core";
import {
  InterruptSchema as SdkInterruptSchema,
  MessageSchema as SdkMessageSchema,
  ResumeEntrySchema as SdkResumeEntrySchema,
  RunAgentInputSchema as SdkRunAgentInputSchema,
} from "@ag-ui/core/schemas";
import { z } from "zod";
import type { ZodType as ProtocolSchema } from "zod/v4";

/** Adapts official protocol validation to the application's Zod 3 contracts. */
function applicationSchema<T>(schema: ProtocolSchema) {
  return z.unknown().transform<T>((value, context) => {
    const parsed = schema.safeParse(value);

    if (!parsed.success) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: parsed.error.message,
      });

      return z.NEVER;
    }

    // The SDK's generated schema permits explicit undefined optional fields;
    // its public interfaces omit those fields under exactOptionalPropertyTypes.
    // Only assert the public type after the official validator accepts the data.
    return parsed.data as T;
  });
}

export const InterruptSchema = applicationSchema<Interrupt>(SdkInterruptSchema);
export const MessageSchema = applicationSchema<Message>(SdkMessageSchema);
export const ResumeEntrySchema =
  applicationSchema<ResumeEntry>(SdkResumeEntrySchema);
export const RunAgentInputSchema = applicationSchema<RunAgentInput>(
  SdkRunAgentInputSchema,
);
