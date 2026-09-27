import { InterruptSchema, type Interrupt, type Message } from "@ag-ui/client";
import { parseA2UICard, type A2UICard } from "./a2ui";

const storageKey = "agent-playground-conversation";

export interface SavedConversation {
  threadId: string;
  messages: Message[];
  cards: A2UICard[];
  pendingInterrupts: Interrupt[];
}

export function newConversation(): SavedConversation {
  return {
    threadId: crypto.randomUUID(),
    messages: [],
    cards: [],
    pendingInterrupts: [],
  };
}

export function loadConversation(): SavedConversation {
  try {
    const saved = JSON.parse(
      localStorage.getItem(storageKey) ?? "null",
    ) as SavedConversation | null;
    if (saved?.threadId && Array.isArray(saved.messages)) {
      const cards = Array.isArray(saved.cards)
        ? saved.cards.flatMap((card) => {
            if (typeof card !== "object" || card === null) return [];
            const id =
              typeof card.id === "string"
                ? card.id
                : typeof card.toolCallId === "string"
                  ? card.toolCallId
                  : null;
            if (id === null) return [];
            const parsed = parseA2UICard(
              id,
              JSON.stringify({ kind: "a2ui", messages: card.messages }),
              card.toolCallId,
            );
            return parsed ? [parsed] : [];
          })
        : [];
      const pending = InterruptSchema.array().safeParse(
        saved.pendingInterrupts,
      );
      return {
        threadId: saved.threadId,
        messages: saved.messages,
        cards,
        pendingInterrupts: pending.success ? pending.data : [],
      };
    }
  } catch {
    // A malformed local cache should not prevent a new chat.
  }
  return newConversation();
}

export function saveConversation(conversation: SavedConversation): void {
  localStorage.setItem(storageKey, JSON.stringify(conversation));
}
