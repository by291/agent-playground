import { ChatCircleIcon } from "@phosphor-icons/react/dist/csr/ChatCircle";
import { DatabaseIcon } from "@phosphor-icons/react/dist/csr/Database";
import { ListChecksIcon } from "@phosphor-icons/react/dist/csr/ListChecks";
import { ChartBarIcon } from "@phosphor-icons/react/dist/csr/ChartBar";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

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
          icon={<DatabaseIcon size={17} aria-hidden="true" />}
          title="Review SQL"
          prompt="Start a SQL review workflow to list id and amount from paid orders."
          onSelect={onSelect}
        />
        <Suggestion
          icon={<ChartBarIcon size={17} aria-hidden="true" />}
          title="Generate report"
          prompt="Generate a report using the asynchronous report workflow and show its progress."
          onSelect={onSelect}
        />
        <Suggestion
          icon={<ListChecksIcon size={17} aria-hidden="true" />}
          title="Collaborate with agents"
          prompt="Use run_a2a_workflow to have agents plan, review, and revise an order analysis proposal."
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
    <Button
      type="button"
      variant="outline"
      onClick={() => onSelect(prompt)}
      className="h-auto min-h-11 gap-2 border-line bg-surface px-4 py-2.5 text-[13px]/5 text-ink"
    >
      <span className="flex shrink-0 items-center text-muted">{icon}</span>
      {title}
    </Button>
  );
}
