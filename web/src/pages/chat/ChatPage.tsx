import { SettingsProvider } from "@/components/SettingsControl";
import {
  ConversationProvider,
  ConversationWorkspace,
  useConversationHistory,
} from "@/features/conversation";
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
        <ConversationWorkspace
          conversation={conversation}
          development={development}
          onNewConversation={() => startNewConversation()}
          history={history}
        />
      </ConversationProvider>
    </SettingsProvider>
  );
}
