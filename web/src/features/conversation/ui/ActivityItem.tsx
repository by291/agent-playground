import { memo, useState } from "react";
import { BrainIcon } from "@phosphor-icons/react/dist/csr/Brain";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { ChatCircleDotsIcon } from "@phosphor-icons/react/dist/csr/ChatCircleDots";
import { CodeIcon } from "@phosphor-icons/react/dist/csr/Code";
import { DatabaseIcon } from "@phosphor-icons/react/dist/csr/Database";
import { GitBranchIcon } from "@phosphor-icons/react/dist/csr/GitBranch";
import { LightningIcon } from "@phosphor-icons/react/dist/csr/Lightning";
import { PulseIcon } from "@phosphor-icons/react/dist/csr/Pulse";
import { WarningCircleIcon } from "@phosphor-icons/react/dist/csr/WarningCircle";
import { EventType } from "@ag-ui/client";
import { cn } from "cn";
import { activityDescription, type ActivityStream } from "../model/activity";
import type { Activity } from "../model/state";
import { JsonPayload } from "./JsonPayload";
import { MergedActivityContent } from "./MergedActivityContent";

const eventCategories = [
  { prefix: "RUN_", label: "Run", Icon: PulseIcon, color: "text-accent" },
  { prefix: "STEP_", label: "Step", Icon: GitBranchIcon, color: "text-muted" },
  {
    prefix: "TEXT_MESSAGE_",
    label: "Message",
    Icon: ChatCircleDotsIcon,
    color: "text-activity-message",
  },
  {
    prefix: "MESSAGES_",
    label: "Message",
    Icon: ChatCircleDotsIcon,
    color: "text-activity-message",
  },
  {
    prefix: "TOOL_",
    label: "Tool",
    Icon: LightningIcon,
    color: "text-activity-tool",
  },
  {
    prefix: "STATE_",
    label: "State",
    Icon: DatabaseIcon,
    color: "text-activity-state",
  },
  {
    prefix: "ACTIVITY_",
    label: "Activity",
    Icon: PulseIcon,
    color: "text-activity-state",
  },
  {
    prefix: "REASONING_",
    label: "Reasoning",
    Icon: BrainIcon,
    color: "text-activity-reasoning",
  },
  {
    prefix: "THINKING_",
    label: "Reasoning",
    Icon: BrainIcon,
    color: "text-activity-reasoning",
  },
];
const customCategory = { label: "Custom", Icon: CodeIcon, color: "text-muted" };
const otherCategory = { label: "Other", Icon: CodeIcon, color: "text-muted" };
const errorCategory = {
  label: "Error",
  Icon: WarningCircleIcon,
  color: "text-destructive",
};

export const ActivityItem = memo(function ActivityItem({
  entry,
  stream,
}: {
  entry: Activity;
  stream: ActivityStream | undefined;
}) {
  const [open, setOpen] = useState(false);
  const { event } = entry;
  const failed = event.type === EventType.RUN_ERROR;
  let category =
    eventCategories.find(({ prefix }) => event.type.startsWith(prefix)) ??
    otherCategory;

  if (failed) {
    category = errorCategory;
  } else if (event.type === EventType.CUSTOM) {
    category = customCategory;
  }

  const { Icon } = category;
  const description = stream
    ? `${stream.events.length} deltas merged · ${stream.content.length} characters`
    : activityDescription(event);
  const receivedAt = new Date(entry.receivedAt);
  const time = receivedAt.toLocaleTimeString([], {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const milliseconds = String(receivedAt.getMilliseconds()).padStart(3, "0");

  return (
    <li>
      <details
        onToggle={(event) => setOpen(event.currentTarget.open)}
        className={cn(
          "group/event overflow-hidden rounded-lg border border-line bg-surface",
          failed && "border-destructive/30",
        )}
      >
        <summary className="flex cursor-pointer list-none items-start gap-3 p-3 outline-none hover:bg-sidebar focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-muted [&::-webkit-details-marker]:hidden">
          <Icon
            size={18}
            aria-hidden="true"
            className={cn("mt-0.5 shrink-0", category.color)}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <span
                className={cn(
                  "break-all font-mono text-xs/5 font-medium text-ink",
                  failed && "text-destructive",
                )}
              >
                {event.type}
              </span>
              <time
                dateTime={receivedAt.toISOString()}
                title={receivedAt.toISOString()}
                className="shrink-0 font-mono text-[11px] tabular-nums text-muted"
              >
                {time}.{milliseconds}
              </time>
            </div>
            {description && (
              <p
                className={cn(
                  "mt-1 wrap-break-word text-[13px]/5 text-ink",
                  failed && "text-destructive",
                )}
              >
                {description}
              </p>
            )}
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]/5">
              <span className={cn("font-medium", category.color)}>
                {category.label}
              </span>
              <span className="text-muted" title={entry.runId}>
                Run {entry.runId.slice(0, 8)}
              </span>
              {stream && (
                <span className="text-muted">
                  {stream.status === "open" && "End not received"}
                  {stream.status === "stopped" && "Stopped"}
                  {stream.status === "complete" &&
                    (stream.partial ? "End received" : "Complete")}
                </span>
              )}
              {stream?.partial && (
                <span className="text-activity-state">Partial content</span>
              )}
            </div>
          </div>
          <CaretRightIcon
            size={12}
            aria-hidden="true"
            className="mt-1 shrink-0 text-muted group-open/event:rotate-90"
          />
        </summary>
        {open && (
          <div className="border-t border-line p-3">
            <p className="text-xs text-muted">Run ID</p>
            <code className="mt-1 block break-all text-xs/5 text-ink">
              {entry.runId}
            </code>
            {stream && (
              <MergedActivityContent
                stream={stream}
                toolArguments={event.type === EventType.TOOL_CALL_ARGS}
              />
            )}
            {!stream && <JsonPayload source={JSON.stringify(event, null, 2)} />}
          </div>
        )}
      </details>
    </li>
  );
});
