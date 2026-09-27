import {
  ChatCircleDotsIcon,
  LightningIcon,
  PulseIcon,
  XIcon,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import type { Activity } from "../conversation/types";

export function ActivityPanel({
  activity,
  threadId,
  onClose,
}: {
  activity: Activity[];
  threadId: string;
  onClose: () => void;
}) {
  return (
    <aside
      aria-label="Run activity"
      className="flex min-w-0 flex-1 flex-col border-l border-line bg-canvas lg:w-85 lg:flex-none xl:w-90"
    >
      <div className="flex items-start justify-between gap-3 border-b border-line p-5">
        <div>
          <div className="flex items-center gap-2 text-[14px] font-semibold text-ink">
            <PulseIcon size={19} className="text-accent" aria-hidden="true" />
            Run activity
          </div>
          <p className="mt-1 text-xs/5 text-muted">
            The AG-UI stream behind this conversation.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          onClick={onClose}
          aria-label="Close run activity"
          className="size-9 text-muted hover:bg-white hover:text-ink"
        >
          <XIcon size={18} aria-hidden="true" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="mb-4 flex items-center justify-between">
          <span className="text-[10px] font-semibold tracking-[0.14em] text-soft uppercase">
            Recent events
          </span>
          <span className="rounded-full border border-accent-line bg-accent-soft px-2 py-0.5 text-[10px] font-semibold text-accent">
            AG-UI
          </span>
        </div>
        {activity.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line bg-white px-5 py-8 text-center">
            <PulseIcon
              size={26}
              className="mx-auto text-soft"
              aria-hidden="true"
            />
            <p className="mt-3 text-sm font-medium text-ink">No activity yet</p>
            <p className="mt-1 text-xs/5 text-muted">
              Events will appear here when you send a message.
            </p>
          </div>
        ) : (
          <ol className="space-y-2">
            {activity.map((event) => (
              <ActivityItem key={event.id} event={event} />
            ))}
          </ol>
        )}
      </div>

      <div className="border-t border-line bg-white/70 px-5 py-4">
        <p className="text-[10px] font-semibold tracking-[0.14em] text-soft uppercase">
          Thread ID
        </p>
        <code className="mt-2 block break-all font-mono text-[11px]/5 text-muted">
          {threadId}
        </code>
      </div>
    </aside>
  );
}

function ActivityItem({ event }: { event: Activity }) {
  const kind = event.type.startsWith("RUN_")
    ? "run"
    : event.type.startsWith("TOOL_")
      ? "tool"
      : "message";
  const Icon =
    kind === "run"
      ? PulseIcon
      : kind === "tool"
        ? LightningIcon
        : ChatCircleDotsIcon;

  return (
    <li className="flex gap-3 rounded-xl border border-line bg-white p-3">
      <span
        className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${
          kind === "tool"
            ? "bg-amber-50 text-amber-700"
            : kind === "run"
              ? "bg-accent-soft text-accent"
              : "bg-sidebar text-muted"
        }`}
      >
        <Icon size={17} aria-hidden="true" />
      </span>
      <div className="min-w-0 pt-0.5">
        <p className="break-all font-mono text-[11px]/5 font-semibold text-ink">
          {event.type}
        </p>
        {event.detail && (
          <p className="mt-0.5 wrap-break-word text-xs/5 text-muted">
            {event.detail}
          </p>
        )}
      </div>
    </li>
  );
}
