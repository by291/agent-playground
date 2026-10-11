import { useState } from "react";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  isExternalTaskTerminal,
  type ExternalTaskSnapshot,
} from "@shared/external-task";
import { MarkdownContent } from "../messages/MarkdownMessage";

type AgentOutput = NonNullable<ExternalTaskSnapshot["outputs"]>[number];

interface AgentStep {
  step: string;
  title: string;
  agent: string;
  description: string;
}

const collaborationSteps: AgentStep[] = [
  {
    step: "plan",
    title: "Draft",
    agent: "Planner",
    description: "Create the first draft.",
  },
  {
    step: "review",
    title: "Review",
    agent: "Reviewer",
    description: "Review Planner's draft.",
  },
  {
    step: "revise",
    title: "Revision",
    agent: "Planner",
    description: "Revise using Reviewer's feedback.",
  },
];
const statusLabels = {
  queued: "Queued",
  running: "Working",
  input_required: "Needs input",
  succeeded: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

function AgentStepOutput({
  step,
  index,
  output,
  task,
  lastOutput,
}: {
  step: AgentStep;
  index: number;
  output: AgentOutput | undefined;
  task: ExternalTaskSnapshot;
  lastOutput: AgentOutput | undefined;
}) {
  const [chosenOpen, setChosenOpen] = useState<boolean | null>(null);
  const terminal = isExternalTaskTerminal(task.status);
  const active = output !== undefined && !isExternalTaskTerminal(output.status);
  const showResult =
    output && (step.step === "revise" || (terminal && output === lastOutput));
  const open = chosenOpen ?? Boolean(active || showResult);
  const agent = output?.agent ?? step.agent;
  const title = `${index + 1}. ${step.title} · ${agent}`;
  let label = terminal ? "Not started" : "Pending";

  if (output) {
    label = statusLabels[output.status];
  }

  const summary = (
    <>
      <span className="text-sm font-medium text-ink">{title}</span>
      <span className="flex shrink-0 items-center gap-2">
        <Badge variant="secondary" className="text-xs text-muted">
          {label}
        </Badge>
        {output && (
          <CaretDownIcon className={open ? "size-4 rotate-180" : "size-4"} />
        )}
      </span>
    </>
  );

  return (
    <section
      aria-label={`${agent} ${step.step}`}
      className="border-l-2 border-line pl-3"
    >
      <Collapsible open={open} onOpenChange={setChosenOpen}>
        {output ? (
          <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 rounded-md py-2 text-left hover:bg-muted-surface">
            {summary}
          </CollapsibleTrigger>
        ) : (
          <div className="flex items-center justify-between gap-3 py-2">
            {summary}
          </div>
        )}
        {task.kind === "a2a" && (
          <div className="mb-2 space-y-1 text-xs/5 text-muted">
            <p>Coordinator → {agent}</p>
            <p>{step.description}</p>
          </div>
        )}
        {output && (
          <CollapsibleContent className="pb-3">
            {output.text ? (
              <div className="chat-markdown pt-2 text-ink">
                <MarkdownContent
                  text={output.text}
                  streaming={!terminal && active}
                  animated={false}
                />
              </div>
            ) : (
              <p className="text-sm/6 text-muted">Waiting for agent output…</p>
            )}
          </CollapsibleContent>
        )}
      </Collapsible>
    </section>
  );
}

export function AgentTaskOutputs({ task }: { task: ExternalTaskSnapshot }) {
  const outputs = task.outputs ?? [];
  const steps =
    task.kind === "a2a"
      ? collaborationSteps
      : outputs.map((output) => ({
          step: output.step,
          title: output.step,
          agent: output.agent,
          description: "",
        }));
  const lastOutput = outputs.at(-1);

  return (
    <div className="space-y-2">
      {steps.map((step, index) => (
        <AgentStepOutput
          key={step.step}
          step={step}
          index={index}
          output={outputs.find((output) => output.step === step.step)}
          task={task}
          lastOutput={lastOutput}
        />
      ))}
    </div>
  );
}
