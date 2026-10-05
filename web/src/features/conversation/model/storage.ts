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

export interface ConversationReference extends Omit<
  SavedConversation,
  "threadId"
> {
  threadId?: string;
  fresh?: true;
}

export function newConversation(): ConversationReference {
  return { empty: true, fresh: true };
}

export function loadConversation(threadId?: string): ConversationReference {
  try {
    const current = localStorage.getItem(storageKey);
    const saved: unknown = JSON.parse(
      (threadId
        ? (localStorage.getItem(`${storageKey}:${threadId}`) ?? current)
        : current) ?? "null",
    );

    if (typeof saved === "object" && saved !== null && "threadId" in saved) {
      if (
        typeof saved.threadId === "string" &&
        (!threadId || saved.threadId === threadId)
      ) {
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

  return threadId ? { threadId } : newConversation();
}

export function saveConversation(conversation: SavedConversation): void {
  // The fresh marker applies only to this page; reloads must check server history.
  const { threadId, pending, empty } = conversation;
  const value = JSON.stringify({ threadId, pending, empty });
  const previous = loadConversation();

  if (previous.threadId && previous.threadId !== threadId && !previous.fresh) {
    // Preserve the pre-upgrade pointer before switching for the first time.
    localStorage.setItem(
      `${storageKey}:${previous.threadId}`,
      JSON.stringify(previous),
    );
  }

  localStorage.setItem(`${storageKey}:${threadId}`, value);
  localStorage.setItem(storageKey, value);
}

export function forgetConversation(threadId: string): void {
  localStorage.removeItem(`${storageKey}:${threadId}`);

  if (loadConversation().threadId === threadId) {
    localStorage.removeItem(storageKey);
  }
}

export function forgetAllConversations(): void {
  try {
    const keys: string[] = [];

    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);

      if (key === storageKey || key?.startsWith(`${storageKey}:`)) {
        keys.push(key);
      }
    }

    for (const key of keys) {
      localStorage.removeItem(key);
    }
  } catch {
    // Unavailable browser storage must not prevent leaving a deleted conversation.
  }
}
