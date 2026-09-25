import type { Message } from "@ag-ui/client";
import { parseA2UICard, type A2UICard } from "./a2ui";

const storageKey = "agent-playground-conversation";

export interface SavedConversation {
  threadId: string;
  messages: Message[];
  cards: A2UICard[];
}

export function newConversation(): SavedConversation {
  return { threadId: crypto.randomUUID(), messages: [], cards: [] };
}

export function loadConversation(): SavedConversation {
  try {
    const saved = JSON.parse(
      localStorage.getItem(storageKey) ?? "null",
    ) as SavedConversation | null;
    if (saved?.threadId && Array.isArray(saved.messages)) {
      const cards = Array.isArray(saved.cards)
        ? saved.cards.flatMap((card) => {
            if (
              typeof card !== "object" ||
              card === null ||
              typeof card.toolCallId !== "string"
            )
              return [];
            const parsed = parseA2UICard(
              card.toolCallId,
              JSON.stringify({ kind: "a2ui", messages: card.messages }),
            );
            return parsed ? [parsed] : [];
          })
        : [];
      return { threadId: saved.threadId, messages: saved.messages, cards };
    }
  } catch {
    // A malformed local cache should not prevent a new chat.
  }
  return newConversation();
}

export function saveConversation(conversation: SavedConversation): void {
  localStorage.setItem(storageKey, JSON.stringify(conversation));
}
