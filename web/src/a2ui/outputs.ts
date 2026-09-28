import { EventType, type BaseEvent } from "@ag-ui/client";
import type { A2uiMessage } from "@a2ui/web_core/v0_9";
import { z } from "zod";
import { parseA2UIMessages } from "./messages";

const outputSchema = z
  .object({
    id: z.string().min(1),
    outputSeq: z.number().int().positive().safe(),
    aguiRunId: z.string().optional(),
    workflowCallId: z.string().optional(),
    toolCallId: z.string().optional(),
    messages: z.unknown(),
  })
  .strict();

export interface A2UIOutput {
  id: string;
  outputSeq: number;
  toolCallId?: string;
  messages: A2uiMessage[];
}

export function parseA2UIOutput(value: unknown): A2UIOutput {
  try {
    const output = outputSchema.parse(value);
    return {
      id: output.id,
      outputSeq: output.outputSeq,
      ...(output.toolCallId ? { toolCallId: output.toolCallId } : {}),
      messages: parseA2UIMessages(output.messages),
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Invalid payload";
    throw new Error(`Invalid A2UI output: ${detail}`, { cause: error });
  }
}

export function parseA2UIEvent(event: BaseEvent): A2UIOutput | null {
  if (event.type !== EventType.CUSTOM || event.name !== "a2ui") return null;
  return parseA2UIOutput(event.value);
}
