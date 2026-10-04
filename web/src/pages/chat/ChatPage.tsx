import { useState } from "react";
import { SettingsProvider } from "@/components/SettingsControl";
import {
  ConversationProvider,
  ConversationWorkspace,
  loadConversation,
  newConversation,
  saveConversation,
  useConversationHistory,
} from "@/features/conversation";

export function ChatPage({ development }: { development: boolean }) {
  const [conversation, setConversation] = useState(() => loadConversation());
  const history = useConversationHistory(
    openConversation,
    (threadId) => {
      if (conversation.threadId === threadId) {
        startNewConversation();
      }
    },
    startNewConversation,
  );

  function openConversation(threadId: string) {
    if (threadId === conversation.threadId) {
      return;
    }

    const next = loadConversation(threadId);

    saveConversation(next);
    setConversation(next);
  }

  function startNewConversation() {
    const next = newConversation();

    try {
      saveConversation(next);
    } catch {
      // Browser storage is optional; always leave the previous workspace.
    }

    setConversation(next);
  }

  return (
    <SettingsProvider onClearConversations={history.clear}>
      <ConversationProvider
        key={conversation.threadId}
        conversation={conversation}
      >
        <ConversationWorkspace
          conversation={conversation}
          development={development}
          onNewConversation={startNewConversation}
          history={history}
        />
      </ConversationProvider>
    </SettingsProvider>
  );
}
