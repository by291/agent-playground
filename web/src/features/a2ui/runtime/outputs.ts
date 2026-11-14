import { EventType, type BaseEvent } from "@ag-ui/client";
import type { A2uiMessage } from "@a2ui/web_core/v0_9";
import { z } from "zod";
import { parseA2UIMessages } from "./messages";
import {
  workflowOutputMetadataSchema,
  type WorkflowOutputMetadata,
} from "@shared/workflow-output";

const safeOutputSequence = z.number().int().safe();
const outputSchema = z
  .object({
    id: z.string().min(1),
    outputSeq: safeOutputSequence.positive(),
    aguiRunId: z.string().optional(),
    workflowCallId: z.string().optional(),
    toolCallId: z.string().optional(),
    messages: z.unknown(),
    workflow: workflowOutputMetadataSchema.optional(),
  })
  .strict();

export interface A2UIOutput {
  id: string;
  outputSeq: number;
  toolCallId?: string;
  messages: A2uiMessage[];
  workflow?: WorkflowOutputMetadata;
}

/** Validates stored output identity, ordering and messages before replay. */
export function parseA2UIOutput(value: unknown): A2UIOutput {
  try {
    const output = outputSchema.parse(value);

    return {
      id: output.id,
      outputSeq: output.outputSeq,
      ...(output.toolCallId ? { toolCallId: output.toolCallId } : {}),
      messages: parseA2UIMessages(output.messages),
      ...(output.workflow ? { workflow: output.workflow } : {}),
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Invalid payload";

    throw new Error(`Invalid A2UI output: ${detail}`, { cause: error });
  }
}

/** Extracts an A2UI output from a live event, ignoring unrelated events. */
export function parseA2UIEvent(event: BaseEvent): A2UIOutput | null {
  if (event.type !== EventType.CUSTOM || event.name !== "a2ui") {
    return null;
  }

  return parseA2UIOutput(event.value);
}
