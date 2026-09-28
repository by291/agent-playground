import { pendingSubmissionSchema, type PendingSubmission } from "./contracts";

const storageKey = "agent-playground-conversation";

export interface SavedConversation {
  threadId: string;
  pending?: PendingSubmission;
  empty?: boolean;
}

export function newConversation(): SavedConversation {
  return { threadId: crypto.randomUUID(), empty: true };
}

export function loadConversation(): SavedConversation {
  try {
    const saved: unknown = JSON.parse(
      localStorage.getItem(storageKey) ?? "null",
    );

    if (typeof saved === "object" && saved !== null && "threadId" in saved) {
      if (typeof saved.threadId === "string") {
        const pending = pendingSubmissionSchema.safeParse(
          "pending" in saved ? saved.pending : undefined,
        );

        return {
          threadId: saved.threadId,
          ...(pending.success ? { pending: pending.data } : {}),
          ...("empty" in saved && typeof saved.empty === "boolean"
            ? { empty: saved.empty }
            : {}),
        };
      }
    }
  } catch {
    // A damaged local pointer should not prevent a new conversation.
  }

  return newConversation();
}

export function saveConversation(conversation: SavedConversation): void {
  localStorage.setItem(storageKey, JSON.stringify(conversation));
}
