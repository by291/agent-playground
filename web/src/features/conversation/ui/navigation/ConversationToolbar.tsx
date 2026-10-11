import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { PulseIcon } from "@phosphor-icons/react/dist/csr/Pulse";
import { SidebarSimpleIcon } from "@phosphor-icons/react/dist/csr/SidebarSimple";
import { SquaresFourIcon } from "@phosphor-icons/react/dist/csr/SquaresFour";
import { useSidebar } from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Ref } from "react";
import { useConversation } from "../../providers/ConversationProvider";

export function ConversationToolbar({
  title,
  development,
  activityOpen,
  activityTrigger,
  onToggleActivity,
  onNewConversation,
}: {
  title: string;
  development: boolean;
  activityOpen: boolean;
  activityTrigger: Ref<HTMLButtonElement>;
  onToggleActivity: () => void;
  onNewConversation: () => void;
}) {
  const { open, openMobile, setOpenMobile, toggleSidebar } = useSidebar();
  const sidebarCollapsed = !open;

  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-line px-3 sm:gap-3 sm:px-6">
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          id="workspace-sidebar-trigger"
          onClick={toggleSidebar}
          aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
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
        {import.meta.env.DEV && development && (
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
                  <span className="hidden text-xs xl:inline">Components</span>
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
              onClick={onToggleActivity}
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
