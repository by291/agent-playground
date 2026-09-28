import {
  ChatCircleDotsIcon,
  PlusIcon,
  SparkleIcon,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";

export function Sidebar({
  threadId,
  onNewConversation,
}: {
  threadId: string;
  onNewConversation: () => void;
}) {
  return (
    <aside className="hidden w-63 shrink-0 flex-col border-r border-line bg-sidebar px-4 py-5 xl:flex">
      <div className="flex items-center gap-3 px-2">
        <div className="flex size-9 items-center justify-center rounded-xl bg-accent text-white shadow-sm">
          <SparkleIcon size={21} weight="fill" aria-hidden="true" />
        </div>
        <div>
          <p className="text-[14px] font-semibold tracking-[-0.03em]">
            agent playground
          </p>
          <p className="text-[11px] text-soft">Runtime workbench</p>
        </div>
      </div>

      <Button
        type="button"
        variant="outline"
        onClick={onNewConversation}
        className="mt-8 h-11 justify-start gap-3 rounded-xl border-accent-line bg-white px-3 text-[13px] text-accent hover:bg-accent-soft hover:text-accent"
      >
        <PlusIcon size={18} aria-hidden="true" />
        New conversation
      </Button>

      <p className="mt-9 px-3 text-[10px] font-semibold tracking-[0.14em] text-soft uppercase">
        Conversations
      </p>
      <div className="mt-3 flex h-11 items-center gap-3 rounded-xl bg-white px-3 text-[13px] font-medium text-ink shadow-sm">
        <ChatCircleDotsIcon
          size={18}
          className="text-accent"
          aria-hidden="true"
        />
        Current conversation
      </div>
      <div className="mt-auto border-t border-line px-3 pt-5">
        <p className="text-[11px] font-medium text-muted">Current thread</p>
        <code className="mt-1 block font-mono text-xs text-ink">
          {threadId.slice(0, 8)}…
        </code>
        <p className="mt-4 text-[11px]/5 text-soft">
          Python agent · Aegra · AG-UI
        </p>
      </div>
    </aside>
  );
}
