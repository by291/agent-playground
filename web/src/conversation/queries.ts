import { queryOptions } from "@tanstack/react-query";
import { fetchConversationSnapshot } from "./snapshot";

export function conversationQueryOptions(threadId: string) {
  return queryOptions({
    queryKey: ["conversation", threadId],
    queryFn: ({ signal }) => fetchConversationSnapshot(threadId, signal),
    refetchInterval: 2000,
    retry: 1,
  });
}
