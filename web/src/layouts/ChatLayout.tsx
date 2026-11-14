import { panelPixels, useStoredPanelSize } from "./useStoredPanelSize";
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  lazy,
  Suspense,
  type CSSProperties,
} from "react";
import { usePanelRef } from "react-resizable-panels";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { SidebarProvider, useSidebar } from "@/components/ui/sidebar";
import { useMediaQuery } from "@/shared/hooks/useMediaQuery";
import {
  ConversationActionsProvider,
  ConversationSidebar,
  ConversationToolbar,
  ConversationTimeline,
  MessageComposer,
  useConversation,
  isEmpty,
  isRunning,
  isRestoring,
  ReplyPresentationProvider,
  type ConversationHistory,
} from "@/features/conversation";

const collapsedStorageKey = "agent-playground-sidebar-collapsed";
const collapsedSidebarWidth = 64;
const minimumMainWidth = 320;
const dockedActivityQuery = "(min-width: 1536px)";
const sidebarWidthPreference = {
  key: "agent-playground-sidebar-width",
  initial: 320,
  minimum: 240,
  maximum: 420,
};
const activityWidthPreference = {
  key: "agent-playground-activity-width",
  initial: 520,
  minimum: 400,
  maximum: 720,
};

const ActivityPanel = import.meta.env.DEV
  ? lazy(async () => ({
      default: (await import("@/features/conversation/ActivityPanel"))
        .ActivityPanel,
    }))
  : null;

function loadSidebarCollapsed() {
  try {
    return localStorage.getItem(collapsedStorageKey) === "true";
  } catch {
    return false;
  }
}

interface ChatLayoutProps {
  conversation: { threadId?: string };
  onNewConversation: () => void;
  development: boolean;
  history?: ConversationHistory;
}

/** Composes the chat workspace and restores its desktop navigation preference. */
export function ChatLayout(props: ChatLayoutProps) {
  const [open, setOpen] = useState(() => !loadSidebarCollapsed());

  function changeOpen(next: boolean) {
    setOpen(next);

    try {
      localStorage.setItem(collapsedStorageKey, String(!next));
    } catch {
      // Preferences are optional; navigation remains available without storage.
    }
  }

  return (
    <SidebarProvider
      open={open}
      onOpenChange={changeOpen}
      className="h-dvh min-h-0 bg-canvas font-sans text-ink"
    >
      <ChatPanels {...props} />
    </SidebarProvider>
  );
}

function ChatPanels({
  conversation,
  onNewConversation,
  development,
  history,
}: ChatLayoutProps) {
  const [activityOpen, setActivityOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const { open, isMobile } = useSidebar();
  const wide = useMediaQuery(dockedActivityQuery);

  const sidebarPanel = usePanelRef();
  const activityPanel = usePanelRef();
  const navigationGroup = useRef<HTMLDivElement>(null);
  const contentGroup = useRef<HTMLDivElement>(null);
  const activityTrigger = useRef<HTMLButtonElement>(null);

  const sidebarSize = useStoredPanelSize(sidebarWidthPreference);
  const activitySize = useStoredPanelSize(activityWidthPreference);
  // The panels read defaultSize on mount. Effects restore live widths later.
  const [initialSidebarWidth] = useState(sidebarSize.size);
  const [initialActivityWidth] = useState(activitySize.size);

  const empty = useConversation(isEmpty);
  const threadId =
    useConversation((state) => state.threadId) ?? conversation.threadId ?? null;
  const savedTitle = useConversation((state) => state.title);
  const status = useConversation((state) => state.runs.at(-1)?.status ?? null);
  const busy = useConversation(
    (state) => isRunning(state) || isRestoring(state),
  );

  const title =
    history?.conversations.find((entry) => entry.threadId === threadId)
      ?.title ??
    savedTitle ??
    (empty ? "New conversation" : "Current conversation");
  const current = {
    threadId: threadId ?? "",
    title,
    status,
    busy,
  };

  const showActivity = import.meta.env.DEV && development && activityOpen;
  const expandedDesktopSidebar = open && !isMobile;
  const sidebarMinimum = isMobile ? 0 : collapsedSidebarWidth;
  const desktopSidebarWidth = open ? sidebarSize.size : collapsedSidebarWidth;
  const sidebarWidth = isMobile ? 0 : desktopSidebarWidth;
  const dockedActivity = showActivity && wide;

  const restoreSidebarSize = useEffectEvent(() => {
    sidebarPanel.current?.resize(sidebarWidth);
  });

  const restoreActivitySize = useEffectEvent(() => {
    activityPanel.current?.resize(dockedActivity ? activitySize.size : 0);
  });

  useEffect(() => {
    // Allow the library to register new constraints and measure the responsive group.
    const frame = requestAnimationFrame(() => restoreSidebarSize());

    return () => cancelAnimationFrame(frame);
  }, [open, isMobile]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => restoreActivitySize());

    return () => cancelAnimationFrame(frame);
  }, [dockedActivity]);

  function closeActivity() {
    const focusInPanel = document.activeElement?.closest("#workspace-activity");

    setActivityOpen(false);

    if (focusInPanel) {
      // Only restore focus when closing would hide the currently focused control.
      activityTrigger.current?.focus();
    }
  }

  return (
    <ConversationActionsProvider history={history} current={current}>
      <ResizablePanelGroup
        id="workspace-layout"
        elementRef={navigationGroup}
        onLayoutChanged={(layout, meta) => {
          const percentage = layout["navigation-panel"];
          const isSidebarResize =
            meta.isUserInteraction &&
            expandedDesktopSidebar &&
            sidebarPanel.current !== null &&
            percentage !== undefined;

          // Responsive restoration must not replace the preferred expanded width.
          if (isSidebarResize) {
            sidebarSize.saveSize(
              panelPixels(navigationGroup.current, percentage),
            );
          }
        }}
      >
        <ResizablePanel
          id="navigation-panel"
          panelRef={sidebarPanel}
          defaultSize={isMobile ? 0 : initialSidebarWidth}
          minSize={
            expandedDesktopSidebar
              ? sidebarWidthPreference.minimum
              : sidebarMinimum
          }
          maxSize={
            expandedDesktopSidebar
              ? sidebarWidthPreference.maximum
              : sidebarMinimum
          }
          groupResizeBehavior="preserve-pixel-size"
          className="workspace-sidebar-shell"
          style={{ overflow: "visible" }}
        >
          <ConversationSidebar
            empty={empty}
            onNewConversation={onNewConversation}
            history={history}
            current={current}
          />
        </ResizablePanel>
        {expandedDesktopSidebar && (
          <ResizableHandle aria-label="Sidebar width" />
        )}
        <ResizablePanel
          id="workspace-main"
          minSize={isMobile ? 0 : minimumMainWidth}
          className="flex min-w-0 flex-col bg-surface"
        >
          <ConversationToolbar
            title={title}
            development={development}
            activityOpen={activityOpen}
            activityTrigger={activityTrigger}
            onToggleActivity={() => setActivityOpen((open) => !open)}
            onNewConversation={onNewConversation}
          />

          <ResizablePanelGroup
            id="workspace-content"
            elementRef={contentGroup}
            className="workspace-content relative min-h-0 flex-1 overflow-hidden"
            data-activity-open={showActivity}
            style={
              { "--activity-width": `${activitySize.size}px` } as CSSProperties
            }
            onLayoutChanged={(layout, meta) => {
              const percentage = layout["activity-panel"];
              const isActivityResize =
                meta.isUserInteraction &&
                dockedActivity &&
                activityPanel.current !== null &&
                percentage !== undefined;

              if (isActivityResize) {
                activitySize.saveSize(
                  panelPixels(contentGroup.current, percentage),
                );
              }
            }}
          >
            <ResizablePanel
              id="workspace-chat-panel"
              minSize={wide ? minimumMainWidth : 0}
              className="flex min-w-0 flex-col"
            >
              <main className="workspace-chat flex size-full min-h-0 min-w-0 flex-col">
                <ReplyPresentationProvider>
                  <ConversationTimeline onSelectPrompt={setPrompt} />
                  <MessageComposer prompt={prompt} onPromptChange={setPrompt} />
                </ReplyPresentationProvider>
              </main>
            </ResizablePanel>
            {dockedActivity && <ResizableHandle aria-label="Activity width" />}
            {import.meta.env.DEV && development && ActivityPanel && (
              <ResizablePanel
                id="activity-panel"
                panelRef={activityPanel}
                defaultSize={initialActivityWidth}
                minSize={dockedActivity ? activityWidthPreference.minimum : 0}
                maxSize={dockedActivity ? activityWidthPreference.maximum : 0}
                groupResizeBehavior="preserve-pixel-size"
                style={{ overflow: "visible" }}
              >
                <div
                  className="workspace-activity-shell"
                  data-open={showActivity}
                  inert={!showActivity}
                  aria-hidden={!showActivity}
                >
                  <Suspense fallback={null}>
                    <ActivityPanel
                      threadId={threadId}
                      onClose={closeActivity}
                    />
                  </Suspense>
                </div>
              </ResizablePanel>
            )}
          </ResizablePanelGroup>
        </ResizablePanel>
      </ResizablePanelGroup>
    </ConversationActionsProvider>
  );
}
