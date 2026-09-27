import {
  PlusIcon,
  PulseIcon,
  SparkleIcon,
  SquaresFourIcon,
} from "@phosphor-icons/react";
import { lazy, Suspense, useState } from "react";
import { ChatPane } from "./chat/ChatPane";
import {
  loadConversation,
  newConversation,
  saveConversation,
  type SavedConversation,
} from "./conversation/storage";
import { useConversation } from "./conversation/useConversation";
import { ActivityPanel } from "./layout/ActivityPanel";
import { ConnectionStatus } from "./layout/ConnectionStatus";
import { Sidebar } from "./layout/Sidebar";

const GalleryPage = lazy(() =>
  import("./a2ui/GalleryPage").then(({ GalleryPage }) => ({
    default: GalleryPage,
  })),
);

export function App() {
  if (window.location.pathname === "/a2ui") {
    return (
      <Suspense
        fallback={
          <div className="min-h-dvh bg-canvas p-8 text-sm text-muted">
            Loading components…
          </div>
        }
      >
        <GalleryPage />
      </Suspense>
    );
  }
  return <ConversationApp />;
}

function ConversationApp() {
  const [conversation, setConversation] = useState(loadConversation);

  function startNewConversation() {
    const next = newConversation();
    saveConversation(next);
    setConversation(next);
  }

  return (
    <ConversationPage
      key={conversation.threadId}
      conversation={conversation}
      onNewConversation={startNewConversation}
    />
  );
}

function ConversationPage({
  conversation,
  onNewConversation,
}: {
  conversation: SavedConversation;
  onNewConversation: () => void;
}) {
  const {
    messages,
    cards,
    reviews,
    waitingForReview,
    activity,
    running,
    recoveryIssue,
    send,
    reviewPlan,
  } = useConversation(conversation);
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
                <span className="hidden rounded-full border border-accent-line bg-accent-soft px-2 py-0.5 text-[10px] font-semibold tracking-wide text-accent sm:inline">
                  EXPERIMENT
                </span>
              </div>
              <p className="hidden text-xs text-soft sm:block">Agent chat</p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
            <ConnectionStatus />
            <a
              href="/a2ui"
              aria-label="A2UI components"
              className="inline-flex size-10 items-center justify-center rounded-xl text-muted hover:bg-sidebar hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent xl:hidden"
            >
              <SquaresFourIcon size={20} aria-hidden="true" />
            </a>
            <button
              type="button"
              onClick={() => setActivityOpen((open) => !open)}
              aria-label={
                activityOpen ? "Hide run activity" : "Show run activity"
              }
              aria-pressed={activityOpen}
              className={`inline-flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                activityOpen
                  ? "bg-accent-soft text-accent"
                  : "text-muted hover:bg-sidebar hover:text-ink"
              }`}
            >
              <PulseIcon size={18} aria-hidden="true" />
              <span className="hidden sm:inline">Activity</span>
              {activity.length > 0 && (
                <span className="rounded-md bg-accent-soft px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-accent">
                  {activity.length}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={onNewConversation}
              aria-label="New conversation"
              className="inline-flex size-10 items-center justify-center rounded-xl text-muted transition-colors hover:bg-sidebar hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent xl:hidden"
            >
              <PlusIcon size={20} aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <main
            className={`${activityOpen ? "hidden lg:flex" : "flex"} min-w-0 flex-1 flex-col`}
          >
            <ChatPane
              messages={messages}
              cards={cards}
              reviews={reviews}
              waitingForReview={waitingForReview}
              running={running}
              recoveryIssue={recoveryIssue}
              onSend={send}
              onReview={reviewPlan}
            />
          </main>
          {activityOpen && (
            <ActivityPanel
              activity={activity}
              threadId={conversation.threadId}
              onClose={() => setActivityOpen(false)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
