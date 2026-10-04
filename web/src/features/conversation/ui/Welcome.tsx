import { ChatCircleIcon, ListChecksIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";

export function Welcome({ onSelect }: { onSelect: (prompt: string) => void }) {
  return (
    <div className="my-auto w-full py-8 sm:py-12">
      <div className="welcome-intro">
        <p className="mb-4 text-[11px] font-medium tracking-[0.13em] text-muted uppercase">
          Your agent workspace
        </p>
        <h2 className="max-w-xl text-3xl/tight font-medium tracking-[-0.04em] text-ink sm:text-4xl">
          What would you like <br />
          to work on?
        </h2>
        <p className="mt-4 max-w-lg text-sm/7 text-muted">
          Explore a question. Shape a plan. Move a task forward.
        </p>
      </div>
      <div className="welcome-suggestions mt-8 flex flex-col items-start gap-2.5 sm:flex-row sm:flex-wrap sm:items-center">
        <Suggestion
          icon={<ListChecksIcon size={17} aria-hidden="true" />}
          title="Draft a plan"
          prompt="Create a plan for validating an agent workflow."
          onSelect={onSelect}
        />
        <Suggestion
          icon={<ChatCircleIcon size={17} aria-hidden="true" />}
          title="Explore a question"
          prompt="Help me think through a complex question."
          onSelect={onSelect}
        />
      </div>
    </div>
  );
}

function Suggestion({
  icon,
  title,
  prompt,
  onSelect,
}: {
  icon: ReactNode;
  title: string;
  prompt: string;
  onSelect: (prompt: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(prompt)}
      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-line bg-surface px-4 py-2.5 text-[13px]/5 font-medium text-ink transition-colors duration-150 hover:border-muted/40 hover:bg-sidebar focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <span className="flex shrink-0 items-center text-muted">{icon}</span>
      {title}
    </button>
  );
}
