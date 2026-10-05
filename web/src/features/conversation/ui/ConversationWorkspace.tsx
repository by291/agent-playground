import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { PulseIcon } from "@phosphor-icons/react/dist/csr/Pulse";
import { SidebarSimpleIcon } from "@phosphor-icons/react/dist/csr/SidebarSimple";
import { SquaresFourIcon } from "@phosphor-icons/react/dist/csr/SquaresFour";
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { usePanelRef } from "react-resizable-panels";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { SidebarProvider, useSidebar } from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useMediaQuery } from "@/hooks/use-media-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChatPane } from "@/features/conversation/ui/ChatPane";
import { Composer } from "@/features/conversation/ui/Composer";
import { useConversation } from "@/features/conversation/ConversationProvider";
import { ActivityPanel } from "@/features/conversation/ui/ActivityPanel";
import { ConversationActionsProvider } from "./ConversationActions";
import { Sidebar } from "@/features/conversation/ui/Sidebar";
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

interface WorkspaceProps {
  conversation: { threadId?: string };
  onNewConversation: () => void;
  development: boolean;
  history?: ConversationHistory;
}

export function ConversationWorkspace(props: WorkspaceProps) {
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
      <WorkspaceLayout {...props} />
    </SidebarProvider>
  );
}

function useStoredPanelSize(
  key: string,
  initial: number,
  minimum: number,
  maximum: number,
) {
  const [size, setSize] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(key));

      return saved >= minimum && saved <= maximum ? saved : initial;
    } catch {
      return initial;
    }
  });

  function saveSize(pixels: number) {
    const next = Math.min(maximum, Math.max(minimum, pixels));

    setSize(next);

    try {
      localStorage.setItem(key, String(next));
    } catch {
      // Resizing does not depend on persistent browser preferences.
    }
  }

  return { size, saveSize };
}

function panelPixels(group: HTMLDivElement | null, percentage: number) {
  if (!group) {
    return 0;
  }

  // Persist the requested layout, not an intermediate width during CSS motion.
  const separators = Array.from(group.children).filter((child) =>
    child.hasAttribute("data-separator"),
  );
  const separatorWidth = separators.reduce(
    (width, child) => width + (child as HTMLElement).offsetWidth,
    0,
  );

  return ((group.clientWidth - separatorWidth) * percentage) / 100;
}

function WorkspaceLayout({
  conversation,
  onNewConversation,
  development,
  history,
}: WorkspaceProps) {
  const [activityOpen, setActivityOpen] = useState(false);
  const { open, isMobile, openMobile, setOpenMobile, toggleSidebar } =
    useSidebar();
  const sidebarCollapsed = !open;
  const wide = useMediaQuery("(min-width: 1536px)");
  const sidebarPanel = usePanelRef();
  const activityPanel = usePanelRef();
  const navigationGroup = useRef<HTMLDivElement>(null);
  const contentGroup = useRef<HTMLDivElement>(null);
  const sidebarSize = useStoredPanelSize(
    "agent-playground-sidebar-width",
    320,
    240,
    420,
  );
  const activitySize = useStoredPanelSize(
    "agent-playground-activity-width",
    520,
    400,
    720,
  );
  const [prompt, setPrompt] = useState("");
  const [initialSidebarWidth] = useState(sidebarSize.size);
  const [initialActivityWidth] = useState(activitySize.size);
  const activityTrigger = useRef<HTMLButtonElement>(null);
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
  const current = { threadId: threadId ?? "", title, status, busy };
  const showActivity = development && activityOpen;
  const sidebarMinimum = isMobile ? 0 : 64;
  const desktopSidebarWidth = open ? sidebarSize.size : 64;
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
      activityTrigger.current?.focus();
    }
  }

  return (
    <ConversationActionsProvider history={history} current={current}>
      <ResizablePanelGroup
        id="workspace-layout"
        elementRef={navigationGroup}
        onLayoutChanged={(layout, meta) => {
          if (
            meta.isUserInteraction &&
            open &&
            !isMobile &&
            sidebarPanel.current
          ) {
            sidebarSize.saveSize(
              panelPixels(navigationGroup.current, layout["navigation-panel"]!),
            );
          }
        }}
      >
        <ResizablePanel
          id="navigation-panel"
          panelRef={sidebarPanel}
          defaultSize={isMobile ? 0 : initialSidebarWidth}
          minSize={open && !isMobile ? 240 : sidebarMinimum}
          maxSize={open && !isMobile ? 420 : sidebarMinimum}
          groupResizeBehavior="preserve-pixel-size"
          className="workspace-sidebar-shell"
          style={{ overflow: "visible" }}
        >
          <Sidebar
            empty={empty}
            onNewConversation={onNewConversation}
            history={history}
            current={current}
          />
        </ResizablePanel>
        {open && !isMobile && <ResizableHandle aria-label="Sidebar width" />}
        <ResizablePanel
          id="workspace-main"
          minSize={isMobile ? 0 : 320}
          className="flex min-w-0 flex-col bg-surface"
        >
          <header className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-line px-3 sm:gap-3 sm:px-6">
            <div className="flex min-w-0 items-center gap-2 sm:gap-3">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                id="workspace-sidebar-trigger"
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
                id="workspace-navigation-trigger"
                onClick={() => setOpenMobile(true)}
                aria-label="Open navigation"
                aria-controls="workspace-sidebar"
                aria-expanded={openMobile}
                className="workspace-toolbar-button size-10 md:hidden"
              >
                <SidebarSimpleIcon size={20} aria-hidden="true" />
              </Button>
              <h1 className="truncate text-sm font-medium">{title}</h1>
            </div>

            <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
              {development && (
                <>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <a
                        href="/dev/a2ui-components"
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="A2UI components (opens in a new tab)"
                        className="workspace-toolbar-button inline-flex h-10 min-w-10 items-center justify-center gap-2 px-2 font-medium xl:px-3"
                      >
                        <SquaresFourIcon size={20} aria-hidden="true" />
                        <span className="hidden text-xs xl:inline">
                          Components
                        </span>
                      </a>
                    </TooltipTrigger>
                    <TooltipContent>
                      A2UI components (opens in a new tab)
                    </TooltipContent>
                  </Tooltip>
                  <Button
                    ref={activityTrigger}
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

          <ResizablePanelGroup
            id="workspace-content"
            elementRef={contentGroup}
            className="workspace-content relative min-h-0 flex-1 overflow-hidden"
            data-activity-open={showActivity}
            style={
              { "--activity-width": `${activitySize.size}px` } as CSSProperties
            }
            onLayoutChanged={(layout, meta) => {
              if (
                meta.isUserInteraction &&
                dockedActivity &&
                activityPanel.current
              ) {
                activitySize.saveSize(
                  panelPixels(contentGroup.current, layout["activity-panel"]!),
                );
              }
            }}
          >
            <ResizablePanel
              id="workspace-chat-panel"
              minSize={wide ? 320 : 0}
              className="flex min-w-0 flex-col"
            >
              <main className="workspace-chat flex size-full min-h-0 min-w-0 flex-col">
                <ReplyPresentationProvider>
                  <ChatPane onSelectPrompt={setPrompt} />
                  <Composer prompt={prompt} onPromptChange={setPrompt} />
                </ReplyPresentationProvider>
              </main>
            </ResizablePanel>
            {dockedActivity && <ResizableHandle aria-label="Activity width" />}
            {development && (
              <ResizablePanel
                id="activity-panel"
                panelRef={activityPanel}
                defaultSize={initialActivityWidth}
                minSize={dockedActivity ? 400 : 0}
                maxSize={dockedActivity ? 720 : 0}
                groupResizeBehavior="preserve-pixel-size"
                style={{ overflow: "visible" }}
              >
                <div
                  className="workspace-activity-shell"
                  data-open={showActivity}
                  inert={!showActivity}
                  aria-hidden={!showActivity}
                >
                  <ActivityPanel threadId={threadId} onClose={closeActivity} />
                </div>
              </ResizablePanel>
            )}
          </ResizablePanelGroup>
        </ResizablePanel>
      </ResizablePanelGroup>
    </ConversationActionsProvider>
  );
}

function ActivityCount() {
  const count = useConversation((state) => state.activityReceived);

  if (!count) {
    return null;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="secondary"
          className="h-auto rounded-md bg-accent-soft px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-accent"
        >
          {count}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        {count} events received since the last log clear
      </TooltipContent>
    </Tooltip>
  );
}
