import {
  pendingSubmissionSchema,
  type PendingSubmission,
} from "../api/contracts";

const storageKey = "agent-playground-conversation";

export interface SavedConversation {
  threadId: string;
  pending?: PendingSubmission;
  empty?: boolean;
  modelId?: string;
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
    let lookupThreadId = threadId;

    if (!lookupThreadId && current) {
      const pointer: unknown = JSON.parse(current);

      if (
        pointer &&
        typeof pointer === "object" &&
        "threadId" in pointer &&
        typeof pointer.threadId === "string"
      ) {
        lookupThreadId = pointer.threadId;
      }
    }

    const saved: unknown = JSON.parse(
      (lookupThreadId
        ? (localStorage.getItem(`${storageKey}:${lookupThreadId}`) ?? current)
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
          ...("modelId" in saved && typeof saved.modelId === "string"
            ? { modelId: saved.modelId }
            : {}),
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
  const { threadId, pending, empty, modelId } = conversation;
  const value = JSON.stringify({ threadId, pending, empty, modelId });
  const previous = loadConversation();

  try {
    localStorage.setItem(`${storageKey}:${threadId}`, value);
  } catch (error) {
    if (pending) {
      // Never send a new operation without the identity needed to reconcile it.
      throw new Error(
        "Cannot save this submission in browser storage. Allow storage or free space, then retry.",
        { cause: error },
      );
    }
  }

  try {
    if (
      previous.threadId &&
      previous.threadId !== threadId &&
      !previous.fresh
    ) {
      // Preserve legacy journals before replacing their only current pointer.
      localStorage.setItem(
        `${storageKey}:${previous.threadId}`,
        JSON.stringify(previous),
      );
    }

    // The current pointer is optional; the per-thread record owns the journal.
    localStorage.setItem(storageKey, JSON.stringify({ threadId, empty }));
  } catch {
    // Navigation and restoration do not depend on this convenience pointer.
  }
}

export function forgetConversation(threadId: string): void {
  try {
    localStorage.removeItem(`${storageKey}:${threadId}`);

    if (loadConversation().threadId === threadId) {
      localStorage.removeItem(storageKey);
    }
  } catch {
    // Server deletion is authoritative even if local caches cannot be cleared.
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
