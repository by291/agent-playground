import {
  conversationSnapshotSchema,
  type ConversationSnapshot,
} from "./contracts";

export async function fetchConversationSnapshot(
  threadId: string,
  signal?: AbortSignal,
): Promise<ConversationSnapshot | null> {
  const response = await fetch(
    `/conversations/${encodeURIComponent(threadId)}`,
    signal ? { signal } : {},
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error("Conversation recovery is unavailable");
  }

  const value: unknown = await response.json();
  const result = conversationSnapshotSchema.safeParse(value);

  if (!result.success) {
    throw new Error("Invalid conversation snapshot", { cause: result.error });
  }

  return result.data;
}
