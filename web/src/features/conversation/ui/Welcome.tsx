import {
  ArrowUpRightIcon,
  ChatCircleIcon,
  ListChecksIcon,
} from "@phosphor-icons/react";
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
      <div className="welcome-suggestions mt-8 grid gap-3 sm:grid-cols-2">
        <Suggestion
          icon={<ListChecksIcon size={19} aria-hidden="true" />}
          title="Draft a plan"
          description="Turn an idea into clear steps"
          prompt="Create a plan for validating an agent workflow."
          onSelect={onSelect}
        />
        <Suggestion
          icon={<ChatCircleIcon size={19} aria-hidden="true" />}
          title="Explore a question"
          description="Think through a problem together"
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
  description,
  prompt,
  onSelect,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  prompt: string;
  onSelect: (prompt: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(prompt)}
      className="group flex min-h-22 items-start gap-3 rounded-lg border border-line bg-surface p-4 text-left transition-colors duration-150 hover:border-muted/40 hover:bg-sidebar focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <span className="mt-0.5 shrink-0 text-muted">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium text-ink">{title}</span>
        <span className="mt-1 block text-xs/5 text-muted">{description}</span>
      </span>
      <ArrowUpRightIcon
        size={16}
        className="mt-0.5 shrink-0 text-muted group-hover:text-ink"
        aria-hidden="true"
      />
    </button>
  );
}
