import { useCallback } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import type { ConversationSummary } from "@shared/conversation";
import {
  conversationHistoryKey,
  conversationHistoryOptions,
  clearSavedConversations,
  deleteSavedConversation,
  renameSavedConversation,
} from "../api/history";
import {
  forgetAllConversations,
  forgetConversation,
} from "../model/conversation-storage";

export interface ConversationHistory {
  conversations: ConversationSummary[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  loadingMore: boolean;
  select: (threadId: string) => void;
  loadMore: () => void;
  retry: () => void;
  refresh: () => void;
  rename: (threadId: string, title: string) => Promise<void>;
  remove: (threadId: string) => Promise<void>;
  clear: () => Promise<void>;
}

export function useConversationHistory(
  select: (threadId: string) => void,
  onDeleted: (threadId: string) => void,
  onCleared: () => void,
): ConversationHistory {
  const client = useQueryClient();
  const query = useInfiniteQuery(conversationHistoryOptions());
  const { hasNextPage, isFetching, fetchNextPage } = query;

  const loadMore = useCallback(() => {
    if (!hasNextPage || isFetching) {
      return;
    }

    void fetchNextPage({ cancelRefetch: false });
  }, [hasNextPage, isFetching, fetchNextPage]);

  const entries = query.data?.pages.flatMap((page) => page.conversations) ?? [];
  // History can move between pages after a title or run update; retain its first row.
  const conversations = entries.filter(
    (entry, index) =>
      entries.findIndex(
        (candidate) => candidate.threadId === entry.threadId,
      ) === index,
  );

  return {
    conversations,
    loading: query.isPending,
    error: query.error?.message ?? null,
    hasMore: query.hasNextPage,
    loadingMore: query.isFetchingNextPage,
    select,
    loadMore,
    retry: () => {
      if (query.isFetchNextPageError) {
        loadMore();
      } else {
        void client.invalidateQueries({ queryKey: conversationHistoryKey });
      }
    },
    refresh: () => {
      void client.invalidateQueries({ queryKey: conversationHistoryKey });
    },
    async rename(threadId, title) {
      await renameSavedConversation(threadId, title);
      await Promise.all([
        client.invalidateQueries({ queryKey: conversationHistoryKey }),
        client.invalidateQueries({ queryKey: ["conversation", threadId] }),
      ]);
    },
    async remove(threadId) {
      await deleteSavedConversation(threadId);

      forgetConversation(threadId);
      onDeleted(threadId);

      // Stop snapshot delivery before removing the deleted thread's cache.
      await client.cancelQueries({ queryKey: ["conversation", threadId] });
      client.removeQueries({ queryKey: ["conversation", threadId] });

      await client.invalidateQueries({ queryKey: conversationHistoryKey });
    },
    async clear() {
      await clearSavedConversations();

      // A late fetch must not repopulate history or snapshots after deletion.
      await Promise.all([
        client.cancelQueries({ queryKey: conversationHistoryKey }),
        client.cancelQueries({ queryKey: ["conversation"] }),
      ]);

      forgetAllConversations();
      client.removeQueries({ queryKey: ["conversation"] });
      client.setQueryData(conversationHistoryKey, {
        pages: [{ conversations: [], nextCursor: null }],
        pageParams: [null],
      });
      onCleared();

      await client.invalidateQueries({ queryKey: conversationHistoryKey });
    },
  };
}
