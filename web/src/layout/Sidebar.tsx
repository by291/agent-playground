import {
  ChatCircleDotsIcon,
  PlusIcon,
  SparkleIcon,
  SquaresFourIcon,
} from "@phosphor-icons/react";

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

      <button
        type="button"
        onClick={onNewConversation}
        className="mt-8 flex h-11 items-center gap-3 rounded-xl border border-accent-line bg-white px-3 text-[13px] font-medium text-accent shadow-[0_1px_2px_rgba(28,41,34,0.03)] transition-colors hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <PlusIcon size={18} aria-hidden="true" />
        New conversation
      </button>

      <p className="mt-9 px-3 text-[10px] font-semibold tracking-[0.14em] text-soft uppercase">
        Workspace
      </p>
      <div className="mt-3 flex h-10 items-center gap-3 rounded-xl bg-white px-3 text-[13px] font-medium text-ink shadow-[0_1px_3px_rgba(28,41,34,0.05)]">
        <ChatCircleDotsIcon
          size={18}
          className="text-accent"
          aria-hidden="true"
        />
        Agent chat
      </div>
      <a
        href="/a2ui"
        className="mt-1 flex h-10 items-center gap-3 rounded-xl px-3 text-[13px] font-medium text-muted hover:bg-white hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <SquaresFourIcon size={18} aria-hidden="true" />
        A2UI components
      </a>
      <div className="mt-3 px-3">
        <p className="text-[11px] text-soft">Current thread</p>
        <code className="mt-1 block font-mono text-[11px] text-muted">
          {threadId.slice(0, 8)}…
        </code>
      </div>

      <div className="mt-auto rounded-2xl border border-line bg-white/80 p-4">
        <div className="flex items-center gap-2 text-xs font-semibold text-ink">
          <span className="size-2 rounded-full bg-accent" />
          Runtime stack
        </div>
        <p className="mt-2 text-[11px]/5 text-muted">
          Python agent · Aegra · AG-UI
        </p>
      </div>
    </aside>
  );
}
