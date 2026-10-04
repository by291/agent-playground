import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { PulseIcon } from "@phosphor-icons/react/dist/csr/Pulse";
import { SidebarSimpleIcon } from "@phosphor-icons/react/dist/csr/SidebarSimple";
import { SquaresFourIcon } from "@phosphor-icons/react/dist/csr/SquaresFour";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChatPane } from "@/features/conversation/ui/ChatPane";
import { Composer } from "@/features/conversation/ui/Composer";
import { useConversation } from "@/features/conversation/ConversationProvider";
import { ActivityPanel } from "@/features/conversation/ui/ActivityPanel";
import { Sidebar } from "@/features/conversation/ui/Sidebar";
import { ResizableSidebar } from "./ResizableSidebar";
import { isEmpty, isRunning, isRestoring } from "../model/selectors";
import { ReplyPresentationProvider } from "./ReplyPresentation";
import type { ConversationHistory } from "../model/useConversationHistory";

const collapsedStorageKey = "agent-playground-sidebar-collapsed";

function loadSidebarCollapsed() {
  try {
    return localStorage.getItem(collapsedStorageKey) === "true";
  } catch {
    return false;
  }
}

export function ConversationWorkspace({
  conversation,
  onNewConversation,
  development,
  history,
}: {
  conversation: { threadId: string };
  onNewConversation: () => void;
  development: boolean;
  history?: ConversationHistory;
}) {
  const [activityOpen, setActivityOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] =
    useState(loadSidebarCollapsed);
  const [prompt, setPrompt] = useState("");
  const [navigationOpen, setNavigationOpen] = useState(false);
  const navigation = useRef<HTMLDialogElement>(null);
  const empty = useConversation(isEmpty);
  const savedTitle = useConversation((state) => state.title);
  const status = useConversation((state) => state.runs.at(-1)?.status ?? null);
  const busy = useConversation(
    (state) => isRunning(state) || isRestoring(state),
  );
  const title =
    history?.conversations.find(
      (entry) => entry.threadId === conversation.threadId,
    )?.title ??
    savedTitle ??
    (empty ? "New conversation" : "Current conversation");
  const current = { threadId: conversation.threadId, title, status, busy };
  const showActivity = development && activityOpen;

  useEffect(() => {
    function closeOnDesktop() {
      if (window.innerWidth >= 768) {
        navigation.current?.close();
      }
    }

    window.addEventListener("resize", closeOnDesktop);

    return () => window.removeEventListener("resize", closeOnDesktop);
  }, []);

  function openNavigation() {
    navigation.current?.showModal();
    setNavigationOpen(true);
  }

  function closeNavigation() {
    navigation.current?.close();
  }

  function startFromNavigation() {
    closeNavigation();
    onNewConversation();
  }

  function toggleSidebar() {
    const collapsed = !sidebarCollapsed;

    setSidebarCollapsed(collapsed);

    try {
      localStorage.setItem(collapsedStorageKey, String(collapsed));
    } catch {
      // Navigation still works when browser preferences cannot be saved.
    }
  }

  return (
    <div className="flex h-dvh bg-canvas font-sans text-ink">
      <ResizableSidebar
        collapsed={sidebarCollapsed}
        empty={empty}
        onNewConversation={onNewConversation}
        history={history}
        current={current}
      />
      <dialog
        ref={navigation}
        id="mobile-navigation"
        aria-label="Conversation navigation"
        onClose={() => setNavigationOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            closeNavigation();
          }
        }}
        className="workspace-navigation-dialog"
      >
        <Sidebar
          mobile
          empty={empty}
          onNewConversation={startFromNavigation}
          onClose={closeNavigation}
          history={history}
          current={current}
        />
      </dialog>

      <div className="flex min-w-0 flex-1 flex-col bg-surface">
        <header className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-line px-3 sm:gap-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={toggleSidebar}
              aria-label={
                sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"
              }
              aria-controls="workspace-sidebar"
              aria-expanded={!sidebarCollapsed}
              className="workspace-toolbar-button workspace-sidebar-toggle hidden size-9 md:inline-flex"
            >
              <SidebarSimpleIcon size={19} aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={openNavigation}
              aria-label="Open navigation"
              aria-controls="mobile-navigation"
              aria-expanded={navigationOpen}
              className="workspace-toolbar-button size-10 md:hidden"
            >
              <SidebarSimpleIcon size={20} aria-hidden="true" />
            </Button>
            <h1 className="truncate text-sm font-medium">{title}</h1>
          </div>

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
            {development && (
              <>
                <a
                  href="/dev/a2ui-components"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="A2UI components (opens in a new tab)"
                  title="A2UI components (opens in a new tab)"
                  className="workspace-toolbar-button inline-flex h-10 min-w-10 items-center justify-center gap-2 px-2 font-medium xl:px-3"
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
                  className="workspace-toolbar-button h-10 px-2 text-xs"
                >
                  <PulseIcon size={18} aria-hidden="true" />
                  <span className="hidden xl:inline">Activity</span>
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
              className="workspace-toolbar-button size-10 md:hidden"
            >
              <PlusIcon size={20} aria-hidden="true" />
            </Button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <main
            className={`${showActivity ? "hidden 2xl:flex" : "flex"} min-w-0 flex-1 flex-col`}
          >
            <ReplyPresentationProvider>
              <ChatPane onSelectPrompt={setPrompt} />
              <Composer
                prompt={prompt}
                onPromptChange={setPrompt}
                threadId={conversation.threadId}
              />
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
  const count = useConversation((state) => state.activityReceived);

  if (!count) {
    return null;
  }

  return (
    <Badge
      variant="secondary"
      title={`${count} events received since the last log clear`}
      className="h-auto rounded-md bg-accent-soft px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-accent"
    >
      {count}
    </Badge>
  );
}
