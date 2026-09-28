import {
  PlusIcon,
  PulseIcon,
  SparkleIcon,
  SquaresFourIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChatPane } from "./chat/ChatPane";
import { Composer } from "./chat/Composer";
import {
  loadConversation,
  newConversation,
  saveConversation,
} from "./conversation/storage";
import {
  ConversationProvider,
  useConversation,
} from "./conversation/useConversation";
import { ActivityPanel } from "./layout/ActivityPanel";
import { ConnectionStatus } from "./layout/ConnectionStatus";
import { Sidebar } from "./layout/Sidebar";

export function ConversationApp() {
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
      <ConversationPage
        conversation={conversation}
        onNewConversation={startNewConversation}
      />
    </ConversationProvider>
  );
}

function ConversationPage({
  conversation,
  onNewConversation,
}: {
  conversation: { threadId: string };
  onNewConversation: () => void;
}) {
  const [activityOpen, setActivityOpen] = useState(false);

  return (
    <div className="flex h-dvh bg-canvas font-sans text-ink">
      <Sidebar
        threadId={conversation.threadId}
        onNewConversation={onNewConversation}
      />

      <div className="flex min-w-0 flex-1 flex-col bg-surface">
        <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-line px-4 sm:px-6 lg:px-9">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-accent text-white xl:hidden">
              <SparkleIcon size={19} weight="fill" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-[15px] font-semibold tracking-[-0.02em] sm:text-base">
                  Agent Playground
                </h1>
                <Badge
                  variant="secondary"
                  className="hidden border border-accent-line bg-accent-soft text-[10px] font-semibold tracking-wide text-accent sm:inline-flex"
                >
                  EXPERIMENT
                </Badge>
              </div>
              <p className="hidden text-xs text-soft sm:block">Agent chat</p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
            <ConnectionStatus />
            <a
              href="/a2ui"
              aria-label="A2UI components"
              className="inline-flex size-11 items-center justify-center rounded-xl text-muted hover:bg-sidebar hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent xl:hidden"
            >
              <SquaresFourIcon size={20} aria-hidden="true" />
            </a>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setActivityOpen((open) => !open)}
              aria-label={
                activityOpen ? "Hide run activity" : "Show run activity"
              }
              aria-pressed={activityOpen}
              className={`h-11 rounded-xl px-3 hover:bg-sidebar ${
                activityOpen
                  ? "bg-accent-soft text-accent"
                  : "text-muted hover:bg-sidebar hover:text-ink"
              }`}
            >
              <PulseIcon size={18} aria-hidden="true" />
              <span className="hidden sm:inline">Activity</span>
              <ActivityCount />
            </Button>
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
            className={`${activityOpen ? "hidden lg:flex" : "flex"} min-w-0 flex-1 flex-col`}
          >
            <ChatPane />
            <Composer />
          </main>
          {activityOpen && (
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
  if (!count) return null;
  return (
    <Badge
      variant="secondary"
      className="h-auto rounded-md bg-accent-soft px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-accent"
    >
      {count}
    </Badge>
  );
}
