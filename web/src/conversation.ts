import type { Message } from "@ag-ui/client";

const storageKey = "agent-playground-conversation";

export interface SavedConversation {
  threadId: string;
  messages: Message[];
}

export function newConversation(): SavedConversation {
  return { threadId: crypto.randomUUID(), messages: [] };
}

export function loadConversation(): SavedConversation {
  try {
    const saved = JSON.parse(
      localStorage.getItem(storageKey) ?? "null",
    ) as SavedConversation | null;
    if (saved?.threadId && Array.isArray(saved.messages)) return saved;
  } catch {
    // A malformed local cache should not prevent a new chat.
  }
  return newConversation();
}

export function saveConversation(conversation: SavedConversation): void {
  localStorage.setItem(storageKey, JSON.stringify(conversation));
}
