import { Fragment, useMemo, useState, type CSSProperties } from "react";
import { CopyIcon } from "@phosphor-icons/react/dist/csr/Copy";
import { PulseIcon } from "@phosphor-icons/react/dist/csr/Pulse";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { Button } from "@/components/ui/button";
import { useConversation } from "../ConversationProvider";
import { ActivityItem } from "./ActivityItem";
import { activityRows } from "../model/activity";
import { usePanelWidth } from "./usePanelWidth";

export function ActivityPanel({
  threadId,
  onClose,
}: {
  threadId: string;
  onClose: () => void;
}) {
  const panelWidth = usePanelWidth({
    storageKey: "agent-playground-activity-width",
    minimumWidth: 400,
    maximumWidth: 720,
    defaultWidth: 520,
    side: "right",
  });
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
      className="activity-panel-enter relative flex min-w-0 flex-1 flex-col border-l border-line bg-canvas 2xl:w-(--activity-width) 2xl:flex-none"
      style={{ "--activity-width": `${panelWidth.width}px` } as CSSProperties}
    >
      <div
        {...panelWidth.handleProps}
        aria-label="Activity width"
        aria-controls="workspace-activity"
        className="group absolute inset-y-0 -left-3 z-10 hidden w-6 touch-none cursor-col-resize focus-visible:outline-none 2xl:block"
      >
        <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-accent opacity-0 group-hover:opacity-60 group-focus-visible:opacity-100" />
      </div>
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
        <label className="mt-2 flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-ink">
          <input
            type="checkbox"
            checked={mergeContent}
            onChange={(event) => setMergeContent(event.target.checked)}
            className="size-4 accent-accent"
          />
          Merge stream content
        </label>
        {copyStatus === "copied" && (
          <p role="status" className="mt-1 text-xs text-muted">
            Log copied.
          </p>
        )}
        {copyStatus === "failed" && (
          <p role="alert" className="mt-1 text-xs text-destructive">
            Could not copy the log. Check clipboard access and try again.
          </p>
        )}
        {received > activity.length && (
          <p className="mt-1 text-xs/5 text-muted">
            Older events were discarded. This is a partial log.
          </p>
        )}
        {issues.length > 0 && (
          <div
            role="alert"
            className="mt-2 max-h-32 overflow-auto rounded-md border border-destructive/30 bg-surface p-2 text-xs/5 text-destructive"
          >
            <p className="font-medium">Current client issues</p>
            {issues.map(([kind, detail]) => (
              <p key={kind} className="mt-1 wrap-break-word">
                <span className="capitalize">{kind}</span>: {detail}
              </p>
            ))}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:px-5">
        {activity.length === 0 && (
          <div className="rounded-lg border border-dashed border-line bg-surface px-4 py-6 text-center">
            <p className="text-sm font-medium text-ink">No activity yet</p>
            <p className="mt-1 text-xs/5 text-muted">
              Send a message to capture its live events. Restored conversations
              do not include past events.
            </p>
          </div>
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
                      <span
                        aria-hidden="true"
                        className="h-px flex-1 bg-line"
                      />
                      <h3
                        aria-label={`Run ${runId}`}
                        title={runId}
                        className="shrink-0 font-mono text-xs font-medium text-muted"
                      >
                        Run {runId.slice(0, 8)}
                      </h3>
                      <span
                        aria-hidden="true"
                        className="h-px flex-1 bg-line"
                      />
                    </li>
                  )}
                  <ActivityItem entry={row.entry} stream={row.stream} />
                </Fragment>
              );
            })}
          </ol>
        )}
      </div>

      <div className="shrink-0 border-t border-line bg-surface/70 px-4 py-3">
        <p className="text-[11px] text-muted">Thread ID</p>
        <code className="mt-1 block break-all font-mono text-[11px]/5 text-ink">
          {threadId}
        </code>
        <p className="mt-2 text-xs/5 text-muted">
          Refreshing or switching conversations clears this log.
        </p>
      </div>
    </aside>
  );
}
