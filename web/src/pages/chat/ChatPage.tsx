import { SettingsProvider } from "@/components/settings";
import {
  ConversationProvider,
  useConversationHistory,
} from "@/features/conversation";
import { ChatLayout } from "@/layouts/ChatLayout";
import { useConversationNavigation } from "./useConversationNavigation";

export function ChatPage({ development }: { development: boolean }) {
  const {
    conversation,
    conversationKey,
    activateConversation,
    openConversation,
    startNewConversation,
  } = useConversationNavigation();
  const history = useConversationHistory(
    openConversation,
    (threadId) => {
      if (conversation.threadId === threadId) {
        startNewConversation("replace");
      }
    },
    () => startNewConversation("replace"),
  );

  return (
    <SettingsProvider onClearConversations={history.clear}>
      <ConversationProvider
        key={conversationKey}
        conversation={conversation}
        onThreadCreated={activateConversation}
      >
        <ChatLayout
          conversation={conversation}
          development={development}
          onNewConversation={() => startNewConversation()}
          history={history}
        />
      </ConversationProvider>
    </SettingsProvider>
  );
}
