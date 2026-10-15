import { useState, type ReactNode } from "react";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ClockIcon } from "@phosphor-icons/react/dist/csr/Clock";
import { WarningCircleIcon } from "@phosphor-icons/react/dist/csr/WarningCircle";
import { WrenchIcon } from "@phosphor-icons/react/dist/csr/Wrench";
import { StackIcon } from "@phosphor-icons/react/dist/csr/Stack";
import { BrainIcon } from "@phosphor-icons/react/dist/csr/Brain";
import { skillIdentity } from "../../model/skill-execution";
import { isMemoryTool } from "../../model/memory-execution";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import MarkdownMessage from "./MarkdownMessage";
import { messageText } from "../../model/presentation";
import type { toolProcess, ToolStep } from "../../model/turns";

const toolLabels: Record<string, string> = {
  ask_user: "Ask for input",
  write_todos: "Update plan",
  search_memory: "Search memory",
  remember_memory: "Remember a fact",
  forget_memory: "Forget a fact",
  search_knowledge: "Search knowledge",
  load_skill: "Load a Skill",
  read_skill_file: "Read a Skill file",
  run_skill_script: "Run a Skill script",
  get_current_time: "Check the time",
  calculate_sum: "Calculate a sum",
  run_experiment_workflow: "Build an experiment plan",
  run_sql_workflow: "Review SQL",
  run_report_workflow: "Generate report",
  run_a2a_workflow: "Collaborate with agents",
};

function processStatusLabel(steps: ToolStep[]) {
  // A group can mix outcomes; failures and blocked work take priority over progress.
  if (steps.some((step) => step.status === "failed")) {
    return "Failed";
  }

  if (steps.some((step) => step.status === "waiting")) {
    return "Waiting for external task";
  }

  if (steps.some((step) => step.status === "paused")) {
    return "Waiting for your review";
  }

  if (steps.some((step) => step.status === "running")) {
    return "Running";
  }

  if (steps.some((step) => step.status === "unavailable")) {
    return "Results unavailable";
  }

  return "Completed";
}

function StatusIcon({ status }: { status: ToolStep["status"] }) {
  if (status === "running") {
    return <Spinner aria-hidden="true" />;
  }

  if (status === "completed") {
    return <CheckIcon aria-hidden="true" size={16} />;
  }

  if (status === "paused" || status === "waiting") {
    return <ClockIcon aria-hidden="true" size={16} />;
  }

  return <WarningCircleIcon aria-hidden="true" size={16} />;
}

function readableJson(text: string) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    // Arguments may be incomplete while the model is streaming them.
    return text;
  }
}

function ToolDetails({ step }: { step: ToolStep }) {
  const [open, setOpen] = useState(false);
  const label =
    toolLabels[step.call.function.name] ??
    step.call.function.name.replaceAll("_", " ");
  const skill = skillIdentity(step);
  const statuses = {
    completed: "Completed",
    running: "Running",
    paused: "Waiting for review",
    waiting: "Waiting for external task",
    failed: "Failed",
    unavailable: "Result unavailable",
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-sidebar focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none">
        <StatusIcon status={step.status} />
        <span className="min-w-0 flex-1 wrap-anywhere">
          {skill?.path ?? label}
        </span>
        <span
          key={step.status}
          className="motion-content-enter shrink-0 text-xs text-muted"
        >
          {statuses[step.status]}
        </span>
        <CaretDownIcon
          aria-hidden="true"
          size={12}
          className={`motion-chevron shrink-0 ${open ? "rotate-180" : ""}`}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 px-2 pt-2 pb-3">
        <div>
          <p className="mb-1 text-xs font-medium text-muted">
            {isMemoryTool(step.call.function.name)
              ? "Memory operation"
              : "Tool"}
          </p>
          <code className="text-xs wrap-anywhere">
            {step.call.function.name}
          </code>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-muted">Parameters</p>
          <pre className="max-h-60 overflow-auto rounded-lg bg-sidebar p-3 font-mono text-xs whitespace-pre-wrap wrap-anywhere">
            {readableJson(step.call.function.arguments) ||
              "Waiting for parameters…"}
          </pre>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-muted">Result</p>
          <pre className="max-h-60 overflow-auto rounded-lg bg-sidebar p-3 font-mono text-xs whitespace-pre-wrap wrap-anywhere">
            {step.result
              ? readableJson(messageText(step.result)) || "Empty result"
              : statuses[step.status]}
          </pre>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function ToolProcess({
  process,
  children,
  skillName,
  category = skillName ? "Skill" : "Tool",
}: {
  process: ReturnType<typeof toolProcess>;
  children?: ReactNode;
  skillName?: string;
  category?: "Tool" | "Skill" | "Memory";
}) {
  const [open, setOpen] = useState(false);
  const steps = process.flatMap((entry) => entry.calls);
  const failed = steps.some((step) => step.status === "failed");
  const running = steps.some((step) => step.status === "running");
  const statusLabel = processStatusLabel(steps);
  const error = steps.find((step) => step.result?.error)?.result?.error;
  const countLabel = category === "Memory" ? "operations" : "tools";
  let name =
    skillName ??
    (steps.length === 1
      ? steps[0]!.call.function.name
      : `${steps.length} ${countLabel}`);

  if (name === "write_todos") {
    name = "Update plan";
  }

  let Icon = WrenchIcon;

  if (failed) {
    Icon = WarningCircleIcon;
  } else if (category === "Memory") {
    Icon = BrainIcon;
  } else if (category === "Skill") {
    Icon = StackIcon;
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="w-full min-w-0">
      <Tooltip>
        <TooltipTrigger asChild>
          <CollapsibleTrigger
            aria-label={`${category} ${name} ${statusLabel}`}
            className={`flex min-h-8 max-w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-left text-sm hover:bg-sidebar focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none ${failed ? "text-red-700" : "text-muted"}`}
          >
            {running ? (
              <Spinner aria-hidden="true" className="shrink-0" />
            ) : (
              <Icon aria-hidden="true" size={16} className="shrink-0" />
            )}
            <Badge
              variant="outline"
              className="shrink-0 rounded px-1.5 py-0.5 text-[11px]"
            >
              {category}
            </Badge>
            <span className="min-w-0 truncate font-medium text-ink">
              {name}
            </span>
            <span
              key={statusLabel}
              className="motion-content-enter text-xs"
              role="status"
            >
              {statusLabel}
            </span>
            <CaretDownIcon
              aria-hidden="true"
              size={14}
              className={`motion-chevron shrink-0 ${open ? "rotate-180" : ""}`}
            />
          </CollapsibleTrigger>
        </TooltipTrigger>
        <TooltipContent>{name}</TooltipContent>
      </Tooltip>
      {error && (
        <Alert variant="destructive" className="mt-1 p-2">
          <AlertDescription className="text-xs wrap-anywhere">
            {error}
          </AlertDescription>
        </Alert>
      )}
      <CollapsibleContent className="mt-2 space-y-3 border-l border-line pl-3">
        {process.map((entry, index) => {
          const text = messageText(entry.message);

          return (
            <div key={index} className="space-y-2">
              {text.trim() && (
                <div className="chat-markdown px-2 text-sm text-muted">
                  <MarkdownMessage text={text} streaming={false} />
                </div>
              )}
              {entry.calls.map((step) => (
                <ToolDetails key={step.call.id} step={step} />
              ))}
            </div>
          );
        })}
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}
