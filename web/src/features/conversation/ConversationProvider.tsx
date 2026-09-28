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
import { conversationQueryOptions } from "./api/queries";
import { createConversationSession } from "./runtime/session";
import type { ConversationState } from "./model/state";
import { snapshotPolicy } from "./model/lifecycle";
import type { ConversationReference } from "./model/storage";

const ConversationContext = createContext<ReturnType<
  typeof createConversationSession
> | null>(null);

export function ConversationProvider({
  conversation,
  children,
}: {
  conversation: ConversationReference;
  children: ReactNode;
}) {
  const [session] = useState(() => createConversationSession(conversation));
  const snapshotEnabled = useStore(
    session.store,
    (state) => snapshotPolicy(state.lifecycle).enabled,
  );
  const snapshotPolling = useStore(
    session.store,
    (state) => snapshotPolicy(state.lifecycle).polling,
  );
  const {
    data,
    isFetchedAfterMount,
    isSuccess,
    error,
    refetch,
    dataUpdatedAt,
    errorUpdatedAt,
  } = useQuery({
    ...conversationQueryOptions(conversation.threadId, snapshotPolling),
    enabled: snapshotEnabled,
  });
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
