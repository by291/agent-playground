import { Sidebar, type SidebarConversation } from "./Sidebar";
import type { ConversationHistory } from "../model/useConversationHistory";

import { usePanelWidth } from "./usePanelWidth";

export function ResizableSidebar({
  collapsed,
  empty,
  onNewConversation,
  history,
  current,
}: {
  collapsed: boolean;
  empty: boolean;
  onNewConversation: () => void;
  history?: ConversationHistory | undefined;
  current?: SidebarConversation | undefined;
}) {
  const { width, resizing, handleProps } = usePanelWidth({
    storageKey: "agent-playground-sidebar-width",
    minimumWidth: 240,
    maximumWidth: 420,
    defaultWidth: 320,
    side: "left",
  });

  return (
    <div
      className="workspace-sidebar-shell relative hidden h-full shrink-0 md:block"
      data-resizing={resizing}
      style={{ width: collapsed ? 64 : width }}
    >
      <Sidebar
        collapsed={collapsed}
        empty={empty}
        onNewConversation={onNewConversation}
        history={history}
        current={current}
      />
      {!collapsed && (
        <div
          {...handleProps}
          aria-label="Sidebar width"
          aria-controls="workspace-sidebar"
          className="group absolute inset-y-0 -right-3 z-10 w-6 touch-none cursor-col-resize focus-visible:outline-none"
        >
          <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-accent opacity-0 group-hover:opacity-60 group-focus-visible:opacity-100" />
        </div>
      )}
    </div>
  );
}
