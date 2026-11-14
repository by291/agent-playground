import { SettingsProvider } from "@/components/settings";
import {
  ConversationProvider,
  useConversationHistory,
} from "@/features/conversation";
import { ChatLayout } from "@/layouts/ChatLayout";
import { useConversationNavigation } from "./useConversationNavigation";

/** Connects URL navigation and saved history to the active chat session. */
export function ChatPage({ development }: { development: boolean }) {
  const {
    conversation,
    conversationKey,
    activateConversation,
    openConversation,
    startNewConversation,
    leaveDeletedConversation,
  } = useConversationNavigation();

  const history = useConversationHistory(
    openConversation,
    leaveDeletedConversation,
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
