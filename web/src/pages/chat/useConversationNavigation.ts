import { useCallback, useEffect, useState } from "react";
import {
  loadConversation,
  newConversation,
  saveConversation,
} from "@/features/conversation";
import { conversationIdFromPath, conversationPath } from "./conversation-route";

type HistoryMode = "push" | "replace";

function loadCurrentConversation() {
  const threadId = conversationIdFromPath(window.location.pathname);

  return threadId ? loadConversation(threadId) : newConversation();
}

function rememberConversation(
  conversation: ReturnType<typeof loadConversation>,
) {
  if (!conversation.threadId) {
    return;
  }

  try {
    saveConversation({ ...conversation, threadId: conversation.threadId });
  } catch {
    // URL navigation also works when browser storage is unavailable.
  }
}

function updateConversationUrl(
  threadId: string | undefined,
  mode: HistoryMode,
) {
  const url = new URL(window.location.href);

  url.pathname = threadId ? conversationPath(threadId) : "/";

  if (url.href === window.location.href) {
    return;
  }

  if (mode === "push") {
    window.history.pushState(window.history.state, "", url);
  } else {
    window.history.replaceState(window.history.state, "", url);
  }
}

export function useConversationNavigation() {
  // The key resets session resources on navigation; draft promotion preserves it.
  const [navigation, setNavigation] = useState(() => ({
    conversation: loadCurrentConversation(),
    key: 0,
  }));
  const { conversation } = navigation;

  useEffect(() => {
    updateConversationUrl(conversation.threadId, "replace");

    // Hydration may already have updated this thread's pending submission.
    const latest = conversation.threadId
      ? loadConversation(conversation.threadId)
      : conversation;

    rememberConversation(latest);
  }, [conversation]);

  useEffect(() => {
    function restoreFromUrl() {
      const next = loadCurrentConversation();

      rememberConversation(next);
      setNavigation((previous) => ({
        conversation: next,
        key: previous.key + 1,
      }));
    }

    window.addEventListener("popstate", restoreFromUrl);

    return () => window.removeEventListener("popstate", restoreFromUrl);
  }, []);

  function openConversation(threadId: string) {
    if (threadId === conversation.threadId) {
      return;
    }

    const next = loadConversation(threadId);

    updateConversationUrl(threadId, "push");
    rememberConversation(next);
    setNavigation((previous) => ({
      conversation: next,
      key: previous.key + 1,
    }));
  }

  function startNewConversation(mode: HistoryMode = "push") {
    const next = newConversation();

    updateConversationUrl(next.threadId, mode);
    rememberConversation(next);
    setNavigation((previous) => ({
      conversation: next,
      key: previous.key + 1,
    }));
  }

  const activateConversation = useCallback((threadId: string) => {
    updateConversationUrl(threadId, "replace");

    // Promotion must keep the same mounted session, stream and selected files.
    setNavigation((previous) => ({
      ...previous,
      conversation: { ...previous.conversation, threadId },
    }));
  }, []);

  return {
    conversation,
    conversationKey: navigation.key,
    activateConversation,
    openConversation,
    startNewConversation,
  };
}
