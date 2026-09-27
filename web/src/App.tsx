import {
  ChatCircleDotsIcon,
  PlusIcon,
  PulseIcon,
  SparkleIcon,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { ActivityPanel } from "./ActivityPanel";
import { ChatPane } from "./ChatPane";
import {
  loadConversation,
  newConversation,
  saveConversation,
  type SavedConversation,
} from "./conversation";
import { useConversation } from "./useConversation";

export function App() {
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

function Sidebar({
  threadId,
  onNewConversation,
}: {
  threadId: string;
  onNewConversation: () => void;
}) {
  return (
    <aside className="hidden w-63 shrink-0 flex-col border-r border-line bg-sidebar px-4 py-5 xl:flex">
      <div className="flex items-center gap-3 px-2">
        <div className="flex size-9 items-center justify-center rounded-xl bg-accent text-white shadow-sm">
          <SparkleIcon size={21} weight="fill" aria-hidden="true" />
        </div>
        <div>
          <p className="text-[14px] font-semibold tracking-[-0.03em]">
            agent playground
          </p>
          <p className="text-[11px] text-soft">Runtime workbench</p>
        </div>
      </div>

      <button
        type="button"
        onClick={onNewConversation}
        className="mt-8 flex h-11 items-center gap-3 rounded-xl border border-accent-line bg-white px-3 text-[13px] font-medium text-accent shadow-[0_1px_2px_rgba(28,41,34,0.03)] transition-colors hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <PlusIcon size={18} aria-hidden="true" />
        New conversation
      </button>

      <p className="mt-9 px-3 text-[10px] font-semibold tracking-[0.14em] text-soft uppercase">
        Workspace
      </p>
      <div className="mt-3 flex h-10 items-center gap-3 rounded-xl bg-white px-3 text-[13px] font-medium text-ink shadow-[0_1px_3px_rgba(28,41,34,0.05)]">
        <ChatCircleDotsIcon
          size={18}
          className="text-accent"
          aria-hidden="true"
        />
        Agent chat
      </div>
      <div className="mt-3 px-3">
        <p className="text-[11px] text-soft">Current thread</p>
        <code className="mt-1 block font-mono text-[11px] text-muted">
          {threadId.slice(0, 8)}…
        </code>
      </div>

      <div className="mt-auto rounded-2xl border border-line bg-white/80 p-4">
        <div className="flex items-center gap-2 text-xs font-semibold text-ink">
          <span className="size-2 rounded-full bg-accent" />
          Runtime stack
        </div>
        <p className="mt-2 text-[11px]/5 text-muted">
          Python agent · Aegra · AG-UI
        </p>
      </div>
    </aside>
  );
}

function ConnectionStatus() {
  const [connected, setConnected] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/health")
      .then((response) => setConnected(response.ok))
      .catch(() => setConnected(false));
  }, []);

  const label =
    connected === null
      ? "Checking gateway"
      : connected
        ? "Gateway online"
        : "Gateway offline";

  return (
    <div
      role="status"
      className="hidden items-center gap-2 text-xs font-medium text-muted md:flex"
    >
      <span
        className={`size-2 rounded-full ${
          connected === null
            ? "bg-amber-400"
            : connected
              ? "bg-emerald-600"
              : "bg-red-500"
        }`}
      />
      {label}
    </div>
  );
}
