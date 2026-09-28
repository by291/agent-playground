import { AppBrand } from "@/components/AppBrand";
import { PlusIcon, PulseIcon, SquaresFourIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChatPane } from "@/features/conversation/ui/ChatPane";
import { Composer } from "@/features/conversation/ui/Composer";
import { ContextIndicator } from "@/features/conversation/ui/ContextIndicator";
import { useConversation } from "@/features/conversation/ConversationProvider";
import { ActivityPanel } from "@/features/conversation/ui/ActivityPanel";
import { ConnectionStatus } from "@/components/ConnectionStatus";
import { Sidebar } from "@/features/conversation/ui/Sidebar";
import { ReplyPresentationProvider } from "./ReplyPresentation";

export function ConversationWorkspace({
  conversation,
  onNewConversation,
  development,
}: {
  conversation: { threadId: string };
  onNewConversation: () => void;
  development: boolean;
}) {
  const [activityOpen, setActivityOpen] = useState(false);
  const showActivity = development && activityOpen;

  return (
    <div className="flex h-dvh bg-canvas font-sans text-ink">
      <Sidebar
        threadId={conversation.threadId}
        onNewConversation={onNewConversation}
      />

      <div className="flex min-w-0 flex-1 flex-col bg-surface">
        <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-line px-4 sm:px-6 lg:px-9">
          <AppBrand subtitle="Agent chat" iconClassName="xl:hidden" />

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
            <ContextIndicator />
            <ConnectionStatus />
            {development && (
              <>
                <a
                  href="/dev/a2ui-components"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="A2UI components (opens in a new tab)"
                  title="A2UI components (opens in a new tab)"
                  className="inline-flex h-11 min-w-11 items-center justify-center gap-2 rounded-xl px-2 font-medium text-muted hover:bg-sidebar hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent xl:px-3"
                >
                  <SquaresFourIcon size={20} aria-hidden="true" />
                  <span className="hidden text-xs xl:inline">Components</span>
                </a>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setActivityOpen((open) => !open)}
                  aria-label={
                    activityOpen ? "Hide run activity" : "Show run activity"
                  }
                  aria-pressed={activityOpen}
                  className={`h-11 rounded-xl px-3 text-xs hover:bg-sidebar ${
                    activityOpen
                      ? "bg-accent-soft text-accent"
                      : "text-muted hover:bg-sidebar hover:text-ink"
                  }`}
                >
                  <PulseIcon size={18} aria-hidden="true" />
                  <span className="hidden sm:inline">Activity</span>
                  <ActivityCount />
                </Button>
              </>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon-lg"
              onClick={onNewConversation}
              aria-label="New conversation"
              className="size-11 rounded-xl text-muted hover:bg-sidebar hover:text-ink xl:hidden"
            >
              <PlusIcon size={20} aria-hidden="true" />
            </Button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <main
            className={`${showActivity ? "hidden lg:flex" : "flex"} min-w-0 flex-1 flex-col`}
          >
            <ReplyPresentationProvider>
              <ChatPane />
              <Composer />
            </ReplyPresentationProvider>
          </main>
          {showActivity && (
            <ActivityPanel
              threadId={conversation.threadId}
              onClose={() => setActivityOpen(false)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function ActivityCount() {
  const count = useConversation((state) => state.activity.length);

  if (!count) {
    return null;
  }

  return (
    <Badge
      variant="secondary"
      className="h-auto rounded-md bg-accent-soft px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-accent"
    >
      {count}
    </Badge>
  );
}
