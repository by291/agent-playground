import { useState } from "react";
import {
  ConversationProvider,
  ConversationWorkspace,
  loadConversation,
  newConversation,
  saveConversation,
} from "@/features/conversation";

export function ChatPage({ development }: { development: boolean }) {
  const [conversation, setConversation] = useState(loadConversation);

  function startNewConversation() {
    const next = newConversation();

    saveConversation(next);
    setConversation(next);
  }

  return (
    <ConversationProvider
      key={conversation.threadId}
      conversation={conversation}
    >
      <ConversationWorkspace
        conversation={conversation}
        development={development}
        onNewConversation={startNewConversation}
      />
    </ConversationProvider>
  );
}
