import { useState, type ReactNode } from "react";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { CircleNotchIcon } from "@phosphor-icons/react/dist/csr/CircleNotch";
import { ClockIcon } from "@phosphor-icons/react/dist/csr/Clock";
import { WarningCircleIcon } from "@phosphor-icons/react/dist/csr/WarningCircle";
import { WrenchIcon } from "@phosphor-icons/react/dist/csr/Wrench";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import MarkdownMessage from "./MarkdownMessage";
import { messageText } from "../../model/presentation";
import type { toolProcess, ToolStep } from "../../model/turns";

const toolLabels: Record<string, string> = {
  load_skill: "Load a Skill",
  read_skill_file: "Read a Skill file",
  run_skill_script: "Run a Skill script",
  get_current_time: "Check the time",
  calculate_sum: "Calculate a sum",
  run_experiment_workflow: "Build an experiment plan",
  run_sql_workflow: "Review SQL",
  run_report_workflow: "Generate report",
};

function summary(steps: ToolStep[]) {
  if (steps.some((step) => step.status === "failed")) {
    return "Tool process failed";
  }

  if (steps.some((step) => step.status === "waiting")) {
    return "Waiting for external task";
  }

  if (steps.some((step) => step.status === "paused")) {
    return "Waiting for your review";
  }

  if (steps.some((step) => step.status === "running")) {
    return "Using tools";
  }

  if (steps.some((step) => step.status === "unavailable")) {
    return "Tool results unavailable";
  }

  return `Used ${steps.length} ${steps.length === 1 ? "tool" : "tools"}`;
}

function StatusIcon({ status }: { status: ToolStep["status"] }) {
  if (status === "running") {
    return (
      <CircleNotchIcon
        className="motion-safe:animate-spin"
        aria-hidden="true"
        size={16}
      />
    );
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
        <span className="min-w-0 flex-1 wrap-anywhere">{label}</span>
        <span className="shrink-0 text-xs text-muted">
          {statuses[step.status]}
        </span>
        <CaretDownIcon
          aria-hidden="true"
          size={12}
          className={open ? "rotate-180" : ""}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 px-2 pt-2 pb-3">
        <div>
          <p className="mb-1 text-xs font-medium text-muted">Tool</p>
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
              ? readableJson(step.result.content) || "Empty result"
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
}: {
  process: ReturnType<typeof toolProcess>;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const steps = process.flatMap((entry) => entry.calls);
  const failed = steps.some((step) => step.status === "failed");
  const error = steps.find((step) => step.result?.error)?.result?.error;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="w-full min-w-0">
      <CollapsibleTrigger
        className={`flex min-h-8 max-w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-left text-sm hover:bg-sidebar focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none ${failed ? "text-red-700" : "text-muted"}`}
      >
        {failed ? (
          <WarningCircleIcon aria-hidden="true" size={16} />
        ) : (
          <WrenchIcon aria-hidden="true" size={16} />
        )}
        <span>{summary(steps)}</span>
        <CaretDownIcon
          aria-hidden="true"
          size={14}
          className={open ? "rotate-180" : ""}
        />
      </CollapsibleTrigger>
      {error && (
        <p className="mt-1 line-clamp-2 px-2 text-xs wrap-anywhere text-red-700">
          {error}
        </p>
      )}
      <CollapsibleContent className="mt-2 space-y-3 border-l border-line pl-3">
        {process.map((entry, index) => (
          <div key={index} className="space-y-2">
            {messageText(entry.message).trim() && (
              <div className="chat-markdown px-2 text-sm text-muted">
                <MarkdownMessage
                  text={messageText(entry.message)}
                  streaming={false}
                />
              </div>
            )}
            {entry.calls.map((step) => (
              <ToolDetails key={step.call.id} step={step} />
            ))}
          </div>
        ))}
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}
