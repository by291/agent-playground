import { useEffect, useRef } from "react";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowClockwise";
import { ChatCircleIcon } from "@phosphor-icons/react/dist/csr/ChatCircle";
import { CircleNotchIcon } from "@phosphor-icons/react/dist/csr/CircleNotch";
import { Button } from "@/components/ui/button";
import type { ConversationHistory } from "../model/useConversationHistory";
import { isRunActive, type RunStatus } from "@shared/run-status";
import { ConversationActions } from "./ConversationActions";

export function ConversationList({
  history,
  threadId,
  title,
  status,
  empty,
  collapsed,
  onSelect,
  currentBusy,
}: {
  history: ConversationHistory;
  threadId: string;
  title: string;
  status: RunStatus | null;
  empty: boolean;
  collapsed: boolean;
  onSelect: (threadId: string) => void;
  currentBusy: boolean;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const { hasMore, loadingMore, error, loadMore } = history;
  const entries = history.conversations;
  const currentListed = entries.some((entry) => entry.threadId === threadId);
  const current = { threadId, title, status };
  const rows: (typeof current)[] = [...entries];

  if (!currentListed && !empty) {
    rows.unshift(current);
  }

  useEffect(() => {
    const root = scrollerRef.current;
    const end = endRef.current;

    if (
      !root ||
      !end ||
      !hasMore ||
      loadingMore ||
      error ||
      typeof IntersectionObserver === "undefined"
    ) {
      return;
    }

    let observing = true;
    const observer = new IntersectionObserver(
      (entries) => {
        const reachedBottom = entries.some(
          (entry) => entry.isIntersecting && entry.intersectionRatio === 1,
        );

        if (observing && reachedBottom) {
          loadMore();
        }
      },
      { root, rootMargin: "0px", threshold: 1 },
    );

    observer.observe(end);

    return () => {
      observing = false;
      observer.disconnect();
    };
  }, [hasMore, loadingMore, error, loadMore]);

  return (
    <div className="mt-3 flex min-h-0 flex-1 flex-col gap-2">
      {!collapsed && (
        <div className="flex items-center justify-between px-2">
          <p className="text-[11px] font-medium tracking-widest text-muted uppercase">
            Conversations
          </p>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="workspace-toolbar-button size-8"
            aria-label="Refresh conversations"
            onClick={history.refresh}
          >
            <ArrowClockwiseIcon aria-hidden="true" />
          </Button>
        </div>
      )}
      <div
        ref={scrollerRef}
        className="conversation-history-scroll min-h-0 flex-1 overflow-y-auto"
        data-collapsed={collapsed}
        aria-label="Conversation history"
        aria-busy={history.loading || loadingMore}
      >
        {rows.map((entry) => {
          const selected = entry.threadId === threadId;
          const busy =
            (selected && currentBusy) ||
            (entry.status !== null && isRunActive(entry.status)) ||
            entry.status === "submission_unknown";
          const entryTitle = selected ? title : entry.title;

          return (
            <div
              key={entry.threadId}
              className={`mb-0.5 flex items-center rounded-md ${selected ? "bg-selected" : "hover:bg-selected/60"}`}
            >
              <Button
                type="button"
                variant="ghost"
                className={`h-9 min-w-0 flex-1 rounded-md text-[13px] font-normal hover:bg-transparent max-md:h-10 ${collapsed ? "justify-center gap-0 px-0" : "justify-start gap-2 px-2.5"}`}
                aria-label={entryTitle}
                aria-current={selected ? "page" : undefined}
                title={entryTitle}
                onClick={() => onSelect(entry.threadId)}
              >
                <ChatCircleIcon
                  size={18}
                  className={`size-4 shrink-0 ${selected ? "text-accent" : "text-muted"}`}
                  aria-hidden="true"
                />
                <span
                  className={`workspace-sidebar-label truncate ${collapsed ? "hidden" : ""}`}
                  aria-hidden={collapsed}
                >
                  {entryTitle}
                </span>
              </Button>
              {!collapsed && (currentListed || !selected || !empty) && (
                <ConversationActions
                  threadId={entry.threadId}
                  title={entryTitle}
                  deletionBlocked={busy}
                  history={history}
                />
              )}
            </div>
          );
        })}
        {!collapsed && history.loading && (
          <p role="status" className="px-2 py-3 text-xs text-muted">
            Loading conversations…
          </p>
        )}
        {!collapsed &&
          !history.loading &&
          history.conversations.length === 0 &&
          empty &&
          !history.error && (
            <p className="px-2 py-3 text-xs text-muted">
              Your conversations will appear here after you send a message.
            </p>
          )}
        {!collapsed && history.error && (
          <div className="space-y-2 px-2 py-3">
            <p role="alert" className="text-xs text-destructive">
              {history.error}
            </p>
            <Button type="button" variant="outline" onClick={history.retry}>
              Retry
            </Button>
          </div>
        )}
        {(hasMore || loadingMore) && (
          <div
            ref={endRef}
            role={loadingMore ? "status" : undefined}
            aria-label={loadingMore ? "Loading older conversations" : undefined}
            aria-hidden={loadingMore ? undefined : true}
            className="flex h-8 items-center justify-center gap-2 text-xs text-muted"
          >
            {loadingMore && (
              <>
                <CircleNotchIcon
                  className="size-4 motion-safe:animate-spin"
                  aria-hidden="true"
                />
                {!collapsed && <span>Loading…</span>}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
