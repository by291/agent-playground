import { queryOptions } from "@tanstack/react-query";
import { fetchConversationSnapshot } from "./snapshot";

export function conversationQueryOptions(
  threadId: string,
  snapshotPolling = false,
) {
  return queryOptions({
    queryKey: ["conversation", threadId],
    queryFn: ({ signal }) => fetchConversationSnapshot(threadId, signal),
    refetchInterval: snapshotPolling ? 2000 : false,
    retry: 1,
  });
}
