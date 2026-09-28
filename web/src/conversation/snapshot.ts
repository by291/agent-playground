import {
  InterruptSchema,
  MessageSchema,
  type Interrupt,
  type Message,
} from "@ag-ui/client";
import { parseA2UICard, type A2UICard } from "../a2ui/card";
import type { RunSummary } from "./types";

export interface ConversationSnapshot {
  messages: Message[];
  cards: A2UICard[];
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

  const cards = outputItems.flatMap((output): A2UICard[] => {
    if (typeof output !== "object" || output === null || !("id" in output))
      return [];
    if (typeof output.id !== "string") return [];
    const toolCallId =
      "toolCallId" in output && typeof output.toolCallId === "string"
        ? output.toolCallId
        : undefined;
    const card = parseA2UICard(output.id, output, toolCallId);
    return card ? [card] : [];
  });

  return {
    messages: messages.data,
    cards,
    interrupts: interrupts.data,
    runs: runItems,
  };
}

export function mergeMessages(current: Message[], saved: Message[]): Message[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of saved) byId.set(message.id, message);
  return [...byId.values()];
}
