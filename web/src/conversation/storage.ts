import type { Message, ResumeEntry } from "@ag-ui/client";

const storageKey = "agent-playground-conversation";

export interface PendingSubmission {
  runId: string;
  messageId: string;
  messages: Message[];
  state: Record<string, unknown>;
  userMessage?: Message;
  resume?: ResumeEntry[];
}

export interface SavedConversation {
  threadId: string;
  pending?: PendingSubmission;
}

export function newConversation(): SavedConversation {
  return { threadId: crypto.randomUUID() };
}

export function loadConversation(): SavedConversation {
  try {
    const saved: unknown = JSON.parse(
      localStorage.getItem(storageKey) ?? "null",
    );
    if (typeof saved === "object" && saved !== null && "threadId" in saved) {
      if (typeof saved.threadId === "string") {
        const pending = "pending" in saved ? saved.pending : undefined;
        return {
          threadId: saved.threadId,
          ...(validPending(pending) ? { pending } : {}),
        };
      }
    }
  } catch {
    // A damaged local pointer should not prevent a new conversation.
  }
  return newConversation();
}

function validPending(value: unknown): value is PendingSubmission {
  return (
    typeof value === "object" &&
    value !== null &&
    "runId" in value &&
    typeof value.runId === "string" &&
    "messageId" in value &&
    typeof value.messageId === "string" &&
    "messages" in value &&
    Array.isArray(value.messages) &&
    "state" in value &&
    typeof value.state === "object" &&
    value.state !== null
  );
}

export function saveConversation(conversation: SavedConversation): void {
  localStorage.setItem(storageKey, JSON.stringify(conversation));
}
