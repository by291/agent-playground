import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useStore } from "zustand";
import { subscribeConversationChanges } from "../api/events";
import { conversationQueryOptions } from "../api/queries";
import { createConversationSession } from "../runtime/conversation-session";
import type { ConversationState } from "../model/state";
import { snapshotPolicy } from "../model/lifecycle";
import type { ConversationReference } from "../model/conversation-storage";
import { conversationHistoryKey } from "../api/history";

const ConversationContext = createContext<ReturnType<
  typeof createConversationSession
> | null>(null);

interface ConversationProviderProps {
  conversation: ConversationReference;
  children: ReactNode;
  onThreadCreated?: (threadId: string) => void;
}

export function ConversationProvider({
  conversation,
  children,
  onThreadCreated,
}: ConversationProviderProps) {
  // The route remounts this provider when switching conversations. Promotion of a
  // draft to a saved thread keeps this session and its active resources intact.
  const [session] = useState(() => createConversationSession(conversation));
  const client = useQueryClient();
  const threadId = useStore(session.store, (state) => state.threadId);
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
    ...conversationQueryOptions(threadId ?? "", snapshotPolling),
    enabled: snapshotEnabled && threadId !== null,
  });

  const refresh = useCallback(async () => {
    await refetch({ throwOnError: true });
  }, [refetch]);

  useEffect(() => session.connect(refresh), [session, refresh]);

  useEffect(() => {
    if (!threadId || !snapshotEnabled || typeof EventSource === "undefined") {
      return;
    }

    return subscribeConversationChanges(threadId, () => {
      void client.invalidateQueries({
        queryKey: ["conversation", threadId],
      });
    });
  }, [client, threadId, snapshotEnabled]);

  useEffect(
    () =>
      session.store.subscribe((state, previous) => {
        if (state.threadId && !previous.threadId) {
          onThreadCreated?.(state.threadId);
        }

        const enteredStreaming =
          state.lifecycle.execution === "streaming" &&
          previous.lifecycle.execution !== "streaming";
        const receivedHydratedRuns =
          state.runs !== previous.runs && state.lifecycle.hydration === "ready";

        if (enteredStreaming || receivedHydratedRuns) {
          void client.invalidateQueries({ queryKey: conversationHistoryKey });
        }
      }),
    [session, client, onThreadCreated],
  );

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
