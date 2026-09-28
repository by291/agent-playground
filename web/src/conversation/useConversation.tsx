import { useQuery } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useStore } from "zustand";
import { conversationQueryOptions } from "./queries";
import { createConversationSession, type ConversationState } from "./session";
import type { SavedConversation } from "./storage";

const ConversationContext = createContext<ReturnType<
  typeof createConversationSession
> | null>(null);

export function ConversationProvider({
  conversation,
  children,
}: {
  conversation: SavedConversation;
  children: ReactNode;
}) {
  const [session] = useState(() => createConversationSession(conversation));
  const { data, isFetchedAfterMount, isSuccess, error, refetch } = useQuery(
    conversationQueryOptions(conversation.threadId),
  );
  const refresh = useCallback(async () => {
    const result = await refetch({ throwOnError: true });
    return result.data ?? null;
  }, [refetch]);

  useEffect(() => session.connect(refresh), [session, refresh]);
  useEffect(() => {
    // Cached data may predate a saved submission. Recovery waits for a fresh fetch.
    if (isFetchedAfterMount && isSuccess) session.applySnapshot(data ?? null);
  }, [session, data, isFetchedAfterMount, isSuccess]);
  useEffect(() => {
    session.store.setState({ snapshotIssue: error?.message ?? null });
  }, [session, error]);

  return <ConversationContext value={session}>{children}</ConversationContext>;
}

export function useConversation<T>(
  selector: (state: ConversationState) => T,
): T {
  const session = useContext(ConversationContext);
  if (!session) throw new Error("ConversationProvider is missing");
  return useStore(session.store, selector);
}
