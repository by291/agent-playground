import {
  InterruptSchema,
  MessageSchema,
  type Interrupt,
  type Message,
} from "@ag-ui/client";
import { parseA2UIOutput, type A2UIOutput } from "../a2ui/outputs";
import type { RunSummary } from "./types";

export interface ConversationSnapshot {
  messages: Message[];
  outputs: A2UIOutput[];
  interrupts: Interrupt[];
  runs: RunSummary[];
}

function isRunSummary(value: unknown): value is RunSummary {
  return (
    typeof value === "object" &&
    value !== null &&
    "runId" in value &&
    typeof value.runId === "string" &&
    "status" in value &&
    typeof value.status === "string"
  );
}

export async function fetchConversationSnapshot(
  threadId: string,
  signal?: AbortSignal,
): Promise<ConversationSnapshot | null> {
  const response = await fetch(
    `/conversations/${encodeURIComponent(threadId)}`,
    signal ? { signal } : {},
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Conversation recovery is unavailable");

  const raw: unknown = await response.json();
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Invalid conversation snapshot");
  }
  const snapshot = raw as Record<string, unknown>;
  const messages = MessageSchema.array().safeParse(snapshot.messages);
  const interrupts = InterruptSchema.array().safeParse(snapshot.interrupts);
  const outputs: unknown = snapshot.outputs;
  const runs: unknown = snapshot.runs;
  if (
    !messages.success ||
    !interrupts.success ||
    !Array.isArray(outputs) ||
    !Array.isArray(runs)
  ) {
    throw new Error("Invalid conversation snapshot");
  }
  const outputItems: unknown[] = outputs;
  const runItems: unknown[] = runs;
  if (!runItems.every(isRunSummary)) {
    throw new Error("Invalid conversation snapshot");
  }

  const parsedOutputs = outputItems.map(parseA2UIOutput);

  return {
    messages: messages.data,
    outputs: parsedOutputs,
    interrupts: interrupts.data,
    runs: runItems,
  };
}

export function mergeMessages(current: Message[], saved: Message[]): Message[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of saved) byId.set(message.id, message);
  return [...byId.values()];
}
