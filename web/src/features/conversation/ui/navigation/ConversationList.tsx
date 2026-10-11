import { useEffect, useRef } from "react";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowClockwise";
import { ChatCircleIcon } from "@phosphor-icons/react/dist/csr/ChatCircle";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Empty, EmptyHeader, EmptyDescription } from "@/components/ui/empty";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import type { ConversationHistory } from "../../hooks/useConversationHistory";
import { isRunActive, type RunStatus } from "@shared/run-status";
import { ConversationActions } from "./ConversationActions";
import { AnimatePresence } from "motion/react";
import { AnimatedDiv } from "@/components/ui/motion";

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
    <div className="workspace-sidebar-history flex min-h-0 flex-1 flex-col">
      <div
        className="workspace-history-heading"
        aria-hidden={collapsed}
        inert={collapsed}
      >
        <div className="flex min-h-0 items-center justify-between overflow-hidden pl-2">
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
      </div>
      <ScrollArea
        viewportRef={scrollerRef}
        className="-mr-2 min-h-0 flex-1"
        viewportClassName="conversation-history-scroll"
        viewportProps={{
          "aria-label": "Conversation history",
          "aria-busy": history.loading || loadingMore,
        }}
        data-collapsed={collapsed}
      >
        <AnimatePresence initial={false}>
          {rows.map((entry) => {
            const selected = entry.threadId === threadId;
            const busy =
              (selected && currentBusy) ||
              (entry.status !== null && isRunActive(entry.status)) ||
              entry.status === "submission_unknown";
            const entryTitle = selected ? title : entry.title;

            return (
              <AnimatedDiv
                key={entry.threadId}
                layout="position"
                exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                className={`mb-0.5 flex items-center rounded-md transition-colors duration-(--motion-feedback) ${selected ? "bg-selected" : "hover:bg-selected/60"}`}
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      className="workspace-sidebar-item h-9 min-w-0 flex-1 rounded-md text-[13px] font-normal hover:bg-transparent max-md:h-10"
                      aria-label={entryTitle}
                      aria-current={selected ? "page" : undefined}
                      onClick={() => onSelect(entry.threadId)}
                    >
                      <ChatCircleIcon
                        size={18}
                        className={`size-4 shrink-0 ${selected ? "text-accent" : "text-muted"}`}
                        aria-hidden="true"
                      />
                      <span
                        className="workspace-sidebar-label truncate"
                        aria-hidden={collapsed}
                      >
                        {entryTitle}
                      </span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right">{entryTitle}</TooltipContent>
                </Tooltip>
                {!collapsed && (currentListed || !selected || !empty) && (
                  <ConversationActions
                    threadId={entry.threadId}
                    title={entryTitle}
                    deletionBlocked={busy}
                    history={history}
                  />
                )}
              </AnimatedDiv>
            );
          })}
        </AnimatePresence>
        {!collapsed && history.loading && (
          <div
            role="status"
            aria-label="Loading conversations"
            className="space-y-2 px-2 py-3"
          >
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
          </div>
        )}
        {!collapsed &&
          !history.loading &&
          history.conversations.length === 0 &&
          empty &&
          !history.error && (
            <Empty className="p-2 py-3">
              <EmptyHeader>
                <EmptyDescription className="text-xs">
                  Your conversations will appear here after you send a message.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        {!collapsed && history.error && (
          <div className="space-y-2 px-2 py-3">
            <Alert variant="destructive" className="p-2">
              <AlertDescription className="text-xs">
                {history.error}
              </AlertDescription>
            </Alert>
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
                <Spinner aria-hidden="true" />
                {!collapsed && <span>Loading…</span>}
              </>
            )}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
