import { useEffect, useState } from "react";
import {
  loadConversation,
  newConversation,
  saveConversation,
} from "@/features/conversation";
import { conversationIdFromPath, conversationPath } from "./conversation-route";

type HistoryMode = "push" | "replace";

function loadCurrentConversation() {
  const threadId = conversationIdFromPath(window.location.pathname);

  return loadConversation(threadId ?? undefined);
}

function rememberConversation(
  conversation: ReturnType<typeof loadConversation>,
) {
  try {
    saveConversation(conversation);
  } catch {
    // URL navigation also works when browser storage is unavailable.
  }
}

function updateConversationUrl(threadId: string, mode: HistoryMode) {
  const url = new URL(window.location.href);

  url.pathname = conversationPath(threadId);

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
  const [conversation, setConversation] = useState(loadCurrentConversation);

  useEffect(() => {
    updateConversationUrl(conversation.threadId, "replace");
    // Hydration may already have updated this thread's pending submission.
    const latest = conversation.fresh
      ? conversation
      : loadConversation(conversation.threadId);

    rememberConversation(latest);
  }, [conversation]);

  useEffect(() => {
    function restoreFromUrl() {
      const next = loadCurrentConversation();

      rememberConversation(next);
      setConversation(next);
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
    setConversation(next);
  }

  function startNewConversation(mode: HistoryMode = "push") {
    const next = newConversation();

    updateConversationUrl(next.threadId, mode);
    rememberConversation(next);
    setConversation(next);
  }

  return { conversation, openConversation, startNewConversation };
}
