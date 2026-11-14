import { queryOptions } from "@tanstack/react-query";
import { fetchConversationSnapshot } from "./snapshot";

const recoveryPollIntervalMs = 2000;

/** Uses the same cache key for one-shot fetches and recovery polling. */
export function conversationQueryOptions(
  threadId: string,
  { polling = false }: { polling?: boolean } = {},
) {
  return queryOptions({
    queryKey: ["conversation", threadId],
    queryFn: ({ signal }) => fetchConversationSnapshot(threadId, signal),
    refetchInterval: polling ? recoveryPollIntervalMs : false,
    retry: 1,
  });
}
