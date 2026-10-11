import { Fragment, useMemo, useState } from "react";
import { CopyIcon } from "@phosphor-icons/react/dist/csr/Copy";
import { PulseIcon } from "@phosphor-icons/react/dist/csr/Pulse";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { Button } from "@/components/ui/button";
import { useConversation } from "../../providers/ConversationProvider";
import { ActivityItem } from "./ActivityItem";
import { activityRows } from "../../model/activity";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";

export function ActivityPanel({
  threadId,
  onClose,
}: {
  threadId: string | null;
  onClose: () => void;
}) {
  const activity = useConversation((state) => state.activity);
  const received = useConversation((state) => state.activityReceived);
  const clearActivity = useConversation((state) => state.clearActivity);
  const clientIssues = useConversation((state) => state.issues);
  const latestRun = useConversation((state) => state.runs.at(-1) ?? null);
  const [mergeContent, setMergeContent] = useState(true);
  const rows = useMemo(
    () => activityRows(activity, mergeContent),
    [activity, mergeContent],
  );
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const issues = Object.entries(clientIssues).filter(
    ([, detail]) => detail !== null,
  );

  async function copyLog() {
    const log = {
      threadId,
      exportedAt: new Date().toISOString(),
      received,
      retained: activity.length,
      source: "Decoded AG-UI SDK events",
      latestRun,
      clientIssues,
      events: [...activity].reverse(),
    };

    try {
      await navigator.clipboard.writeText(JSON.stringify(log, null, 2));
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  }

  function clearLog() {
    clearActivity();
    setCopyStatus("idle");
  }

  return (
    <aside
      id="workspace-activity"
      aria-label="Run activity"
      className="relative flex h-full min-w-0 flex-1 flex-col border-l border-line bg-canvas"
    >
      <div className="shrink-0 border-b border-line p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
              <PulseIcon size={18} className="text-accent" aria-hidden="true" />
              Run activity
            </h2>
            <p className="mt-1 text-xs/5 text-muted">
              Decoded AG-UI events received by this page.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close run activity"
            className="workspace-toolbar-button size-8"
          >
            <XIcon size={18} aria-hidden="true" />
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs tabular-nums text-muted">
            {received} received · {activity.length} retained
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={!activity.length && issues.length === 0}
              onClick={() => void copyLog()}
              className="workspace-toolbar-button h-11 gap-1.5 px-2 text-xs sm:h-8"
            >
              <CopyIcon aria-hidden="true" />
              Copy log
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={!activity.length}
              onClick={clearLog}
              className="workspace-toolbar-button h-11 px-2 text-xs sm:h-8"
            >
              Clear log
            </Button>
          </div>
        </div>
        <Field orientation="horizontal" className="mt-2 min-h-11 gap-2.5">
          <Checkbox
            id="merge-stream-content"
            checked={mergeContent}
            onCheckedChange={(checked) => setMergeContent(checked === true)}
          />
          <FieldLabel htmlFor="merge-stream-content">
            Merge stream content
          </FieldLabel>
        </Field>
        {copyStatus === "copied" && (
          <p role="status" className="mt-1 text-xs text-muted">
            Log copied.
          </p>
        )}
        {copyStatus === "failed" && (
          <Alert variant="destructive" className="mt-2">
            <AlertDescription>
              Could not copy the log. Check clipboard access and try again.
            </AlertDescription>
          </Alert>
        )}
        {received > activity.length && (
          <p className="mt-1 text-xs/5 text-muted">
            Older events were discarded. This is a partial log.
          </p>
        )}
        {issues.length > 0 && (
          <Alert
            variant="destructive"
            className="mt-2 max-h-32 overflow-auto text-xs/5"
          >
            <AlertTitle>Current client issues</AlertTitle>
            <AlertDescription>
              {issues.map(([kind, detail]) => (
                <p key={kind} className="mt-1 wrap-break-word">
                  <span className="capitalize">{kind}</span>: {detail}
                </p>
              ))}
            </AlertDescription>
          </Alert>
        )}
      </div>

      <ScrollArea className="min-h-0 flex-1" viewportClassName="p-4 sm:px-5">
        {activity.length === 0 && (
          <Empty className="border border-dashed border-line bg-surface p-4 py-6">
            <EmptyHeader>
              <EmptyTitle>No activity yet</EmptyTitle>
              <EmptyDescription>
                Send a message to capture its live events. Restored
                conversations do not include past events.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        {activity.length > 0 && (
          <ol className="space-y-2">
            {rows.map((row, index) => {
              const runId = row.entry.runId;
              const separatesRuns =
                index > 0 && rows[index - 1]?.entry.runId !== runId;

              return (
                <Fragment key={`${mergeContent ? "merged" : "raw"}-${row.id}`}>
                  {separatesRuns && (
                    <li className="flex items-center gap-3 pt-5 pb-2">
                      <Separator className="flex-1" />
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <h3
                            aria-label={`Run ${runId}`}
                            className="shrink-0 font-mono text-xs font-medium text-muted"
                          >
                            Run {runId.slice(0, 8)}
                          </h3>
                        </TooltipTrigger>
                        <TooltipContent>{runId}</TooltipContent>
                      </Tooltip>
                      <Separator className="flex-1" />
                    </li>
                  )}
                  <ActivityItem entry={row.entry} stream={row.stream} />
                </Fragment>
              );
            })}
          </ol>
        )}
      </ScrollArea>

      <div className="shrink-0 border-t border-line bg-surface/70 px-4 py-3">
        <p className="text-[11px] text-muted">Thread ID</p>
        <code className="mt-1 block break-all font-mono text-[11px]/5 text-ink">
          {threadId ?? "Not started"}
        </code>
        <p className="mt-2 text-xs/5 text-muted">
          Refreshing or switching conversations clears this log.
        </p>
      </div>
    </aside>
  );
}
