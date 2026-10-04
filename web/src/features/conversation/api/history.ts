import { infiniteQueryOptions } from "@tanstack/react-query";
import {
  conversationPageSchema,
  renameConversationSchema,
} from "@shared/conversation";

export const conversationHistoryKey = ["conversation-history"] as const;

export function conversationHistoryOptions() {
  return infiniteQueryOptions({
    queryKey: conversationHistoryKey,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => {
      const query = pageParam
        ? `?${new URLSearchParams({ cursor: pageParam })}`
        : "";
      const response = await fetch(`/conversations${query}`, { signal });

      if (!response.ok) {
        throw new Error("Conversation history is unavailable");
      }

      const result = conversationPageSchema.safeParse(await response.json());

      if (!result.success) {
        throw new Error("Invalid conversation history", {
          cause: result.error,
        });
      }

      return result.data;
    },
    getNextPageParam: (page) => page.nextCursor,
    retry: 1,
  });
}

export async function renameSavedConversation(threadId: string, title: string) {
  const body = renameConversationSchema.parse({ title });

  await manageConversation(`/conversations/${encodeURIComponent(threadId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function deleteSavedConversation(threadId: string) {
  await manageConversation(`/conversations/${encodeURIComponent(threadId)}`, {
    method: "DELETE",
  });
}

export async function clearSavedConversations() {
  await manageConversation("/conversations", { method: "DELETE" });
}

async function manageConversation(url: string, init: RequestInit) {
  const response = await fetch(url, init);

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const message =
      body &&
      typeof body === "object" &&
      "error" in body &&
      typeof body.error === "string"
        ? body.error
        : "Conversation update failed";

    throw new Error(message);
  }
}
