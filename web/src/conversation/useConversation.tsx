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
  const {
    data,
    isFetchedAfterMount,
    isSuccess,
    error,
    refetch,
    dataUpdatedAt,
    errorUpdatedAt,
  } = useQuery(conversationQueryOptions(conversation.threadId));
  const refresh = useCallback(async () => {
    await refetch({ throwOnError: true });
  }, [refetch]);

  useEffect(() => session.connect(refresh), [session, refresh]);
  useEffect(() => {
    // Each completed fetch is delivered once, even when Query preserves the same data object.
    // Cached data predating mount cannot decide whether to retry a saved submission.
    if (!isFetchedAfterMount) {
      return;
    }

    if (isSuccess) {
      session.receiveSnapshot(data ?? null);
    } else if (error) {
      session.receiveSnapshotError(error);
    }
  }, [
    session,
    data,
    isFetchedAfterMount,
    isSuccess,
    error,
    dataUpdatedAt,
    errorUpdatedAt,
  ]);

  return <ConversationContext value={session}>{children}</ConversationContext>;
}

export function useConversation<T>(
  selector: (state: ConversationState) => T,
): T {
  const session = useContext(ConversationContext);

  if (!session) {
    throw new Error("ConversationProvider is missing");
  }

  return useStore(session.store, selector);
}
