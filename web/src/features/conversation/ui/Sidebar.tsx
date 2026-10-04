import { ChatCircleIcon } from "@phosphor-icons/react/dist/csr/ChatCircle";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { StackIcon } from "@phosphor-icons/react/dist/csr/Stack";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
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
  collapsed = false,
  mobile = false,
  empty,
  onNewConversation,
  onClose,
  history,
  current,
}: {
  collapsed?: boolean;
  mobile?: boolean;
  empty: boolean;
  onNewConversation: () => void;
  onClose?: () => void;
  history?: ConversationHistory | undefined;
  current?: SidebarConversation | undefined;
}) {
  const title = empty ? "New conversation" : "Current conversation";

  return (
    <aside
      id={mobile ? "mobile-navigation-content" : "workspace-sidebar"}
      aria-label="Conversation navigation"
      data-collapsed={collapsed}
      className="workspace-sidebar flex size-full shrink-0 flex-col overflow-hidden border-r border-line bg-sidebar px-3 pt-6 pb-2"
    >
      <div className="flex h-10 shrink-0 items-center gap-2.5 px-1">
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
      </div>

      <Button
        type="button"
        variant="outline"
        onClick={onNewConversation}
        aria-label="New conversation"
        title={collapsed ? "New conversation" : undefined}
        className="workspace-sidebar-new h-10 w-full justify-start gap-2 rounded-md border-line bg-surface px-3 text-[13px] text-ink hover:bg-selected hover:text-ink"
      >
        <PlusIcon size={18} aria-hidden="true" />
        <span className="workspace-sidebar-label" aria-hidden={collapsed}>
          New conversation
        </span>
      </Button>

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
            onClose?.();
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
            title={collapsed ? title : undefined}
            className="workspace-sidebar-current flex h-10 w-full items-center gap-2 rounded-md bg-selected px-3 text-[13px]"
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
      <div
        className={`mt-auto flex w-full shrink-0 items-center border-t border-line pt-2 ${collapsed ? "flex-col gap-1" : "justify-between gap-2 px-2"}`}
      >
        <ConnectionStatus compact={collapsed} />
        <SettingsControl onClearConversations={history?.clear} />
      </div>
    </aside>
  );
}
