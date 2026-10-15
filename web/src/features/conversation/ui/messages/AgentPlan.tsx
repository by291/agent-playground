import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { CircleIcon } from "@phosphor-icons/react/dist/csr/Circle";
import { ClockIcon } from "@phosphor-icons/react/dist/csr/Clock";
import { Spinner } from "@/components/ui/spinner";
import { isRunActive, type RunStatus } from "@shared/run-status";
import type { AgentPlanStep } from "../../model/agent-plan";

interface AgentPlanProps {
  todos: AgentPlanStep[];
  status: RunStatus | null;
}

export function AgentPlan({ todos, status }: AgentPlanProps) {
  const completed = todos.filter((todo) => todo.status === "completed").length;
  const active = status !== null && isRunActive(status);

  return (
    <section
      aria-label="Agent plan"
      className="w-full min-w-0 space-y-3 rounded-xl border border-line p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-ink">Agent plan</p>
        <p className="text-xs text-muted" role="status" aria-atomic="true">
          <span className="sr-only">Plan: </span>
          {completed} of {todos.length} completed
        </p>
      </div>

      <ol className="space-y-3">
        {todos.map((todo, index) => {
          let label = "Pending";
          let icon = <CircleIcon aria-hidden="true" size={16} />;

          if (todo.status === "completed") {
            label = "Completed";
            icon = <CheckCircleIcon aria-hidden="true" size={16} />;
          } else if (todo.status === "in_progress") {
            label = "Not completed";
            icon = <ClockIcon aria-hidden="true" size={16} />;

            if (active) {
              label = "In progress";
              icon = <Spinner aria-hidden="true" />;
            } else if (status === "interrupted") {
              label = "Paused";
            }
          }

          return (
            <li key={index} className="flex items-start gap-3">
              <span className="mt-0.5 shrink-0 text-muted">{icon}</span>
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="text-sm wrap-anywhere text-ink">{todo.content}</p>
                <p className="text-xs text-muted">{label}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
