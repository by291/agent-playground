import { BookOpenIcon } from "@phosphor-icons/react/dist/csr/BookOpen";
import { ChatCircleIcon } from "@phosphor-icons/react/dist/csr/ChatCircle";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { StackIcon } from "@phosphor-icons/react/dist/csr/Stack";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import {
  Sidebar as NavigationSidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { ConnectionStatus } from "@/components/ConnectionStatus";
import { SettingsControl } from "@/components/SettingsControl";
import { ConversationList } from "./ConversationList";
import type { ConversationHistory } from "../model/useConversationHistory";
import type { RunStatus } from "@shared/run-status";

export interface SidebarConversation {
  threadId: string;
  title: string;
  status: RunStatus | null;
  busy: boolean;
}

export function Sidebar({
  empty,
  onNewConversation,
  history,
  current,
}: {
  empty: boolean;
  onNewConversation: () => void;
  history?: ConversationHistory | undefined;
  current?: SidebarConversation | undefined;
}) {
  const { open, isMobile: mobile, setOpenMobile } = useSidebar();
  const collapsed = !open && !mobile;
  const onClose = () => setOpenMobile(false);
  const title = empty ? "New conversation" : "Current conversation";

  return (
    <NavigationSidebar
      position="inline"
      collapsible="icon"
      role="complementary"
      id="workspace-sidebar"
      aria-label="Conversation navigation"
      data-collapsed={collapsed}
      className="workspace-sidebar flex size-full shrink-0 flex-col overflow-hidden border-r border-line bg-sidebar px-3 pt-6 pb-2"
    >
      <SidebarHeader className="h-10 shrink-0 flex-row items-center gap-2.5 p-0 px-1">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <StackIcon size={20} aria-hidden="true" />
        </div>
        <div
          className="workspace-sidebar-label min-w-0"
          aria-hidden={collapsed}
        >
          <p className="text-[13px] font-semibold tracking-tight">
            Agent Playground
          </p>
          <p className="mt-0.5 text-xs text-muted">Workspace</p>
        </div>
        {mobile && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close navigation"
            className="ml-auto size-9 text-muted"
          >
            <XIcon size={18} aria-hidden="true" />
          </Button>
        )}
      </SidebarHeader>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              onClose();
              onNewConversation();
            }}
            aria-label="New conversation"
            className="workspace-sidebar-item workspace-sidebar-new h-10 w-full rounded-md border-line bg-surface text-[13px] text-ink hover:bg-selected hover:text-ink"
          >
            <PlusIcon size={18} aria-hidden="true" />
            <span className="workspace-sidebar-label" aria-hidden={collapsed}>
              New conversation
            </span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">New conversation</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <a
            href="/knowledge"
            aria-label="Knowledge"
            className="workspace-sidebar-item mt-2 h-10 shrink-0 rounded-md border border-transparent text-[13px] text-muted hover:bg-selected hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
          >
            <BookOpenIcon size={18} className="shrink-0" aria-hidden="true" />
            <span className="workspace-sidebar-label" aria-hidden={collapsed}>
              Knowledge
            </span>
          </a>
        </TooltipTrigger>
        <TooltipContent side="right">Knowledge</TooltipContent>
      </Tooltip>

      <SidebarContent className="gap-0 overflow-hidden">
        {history && current ? (
          <ConversationList
            history={history}
            threadId={current.threadId}
            title={current.title}
            status={current.status}
            currentBusy={current.busy}
            empty={empty}
            collapsed={collapsed}
            onSelect={(threadId) => {
              history.select(threadId);
              onClose();
            }}
          />
        ) : (
          <>
            <div className="workspace-sidebar-section" aria-hidden={collapsed}>
              <p className="min-h-0 overflow-hidden px-2 text-[11px]/4 font-medium tracking-widest text-muted uppercase">
                Conversations
              </p>
            </div>
            <div
              aria-label={title}
              className="workspace-sidebar-item workspace-sidebar-current h-10 w-full rounded-md border border-transparent bg-selected text-[13px]"
            >
              <ChatCircleIcon
                size={18}
                className="size-4 shrink-0 text-accent"
                aria-hidden="true"
              />
              <span
                className="workspace-sidebar-label truncate"
                aria-hidden={collapsed}
              >
                {title}
              </span>
            </div>
          </>
        )}
      </SidebarContent>
      <SidebarFooter
        className={`mt-auto flex w-full shrink-0 items-center border-t border-line pt-2 ${collapsed ? "flex-col gap-1" : "flex-row justify-between gap-2 px-2"}`}
      >
        <ConnectionStatus compact={collapsed} />
        <SettingsControl onClearConversations={history?.clear} />
      </SidebarFooter>
    </NavigationSidebar>
  );
}
