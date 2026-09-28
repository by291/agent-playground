import {
  pendingSubmissionSchema,
  type PendingSubmission,
} from "../api/contracts";

const storageKey = "agent-playground-conversation";

export interface SavedConversation {
  threadId: string;
  pending?: PendingSubmission;
  empty?: boolean;
}

export interface ConversationReference extends SavedConversation {
  fresh?: true;
}

export function newConversation(): ConversationReference {
  return { threadId: crypto.randomUUID(), empty: true, fresh: true };
}

export function loadConversation(): ConversationReference {
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
  // The fresh marker applies only to this page; reloads must check server history.
  const { threadId, pending, empty } = conversation;

  localStorage.setItem(
    storageKey,
    JSON.stringify({ threadId, pending, empty }),
  );
}
