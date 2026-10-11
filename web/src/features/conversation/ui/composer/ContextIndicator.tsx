import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverClose,
} from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useConversation } from "../../providers/ConversationProvider";
import { agentInfoQueryOptions } from "../../api/agent-info";
import { canSelectModel } from "../../model/selectors";
import type { ContextUsage } from "@shared/context-usage";

const compactNumber = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const tokenNumber = new Intl.NumberFormat("en-US");
const categories = [
  { key: "system", label: "System instructions", color: "bg-slate-500" },
  { key: "tools", label: "Tool definitions", color: "bg-sky-500" },
  { key: "conversation", label: "Conversation", color: "bg-accent" },
  { key: "toolResults", label: "Tool results", color: "bg-amber-500" },
  { key: "summary", label: "Compacted summary", color: "bg-violet-500" },
] as const;

export function ContextIndicator({ disabled = false }: { disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const groupId = useId();
  const reportedUsage = useConversation((state) => state.contextUsage);
  const modelId = useConversation((state) => state.modelId);
  const selectModel = useConversation((state) => state.selectModel);
  const selectable = useConversation(canSelectModel);
  const modelSwitching = useConversation((state) => state.modelSwitching);
  const { data: agentInfo } = useQuery(agentInfoQueryOptions());

  const models = agentInfo?.models ?? [];
  const hasCatalog = models.length > 0;
  const effectiveModelId = modelId ?? agentInfo?.defaultModelId;
  const selectedModel = agentInfo?.models?.find(
    (option) => option.id === effectiveModelId,
  );
  const model =
    selectedModel?.model ?? agentInfo?.model ?? reportedUsage?.model ?? "Model";
  // Usage from the previous model must not appear against the newly selected one.
  const usage = reportedUsage?.model === model ? reportedUsage : null;
  const ratio = usage ? usage.usedTokens / usage.contextWindow : 0;
  const percentage = Math.round(ratio * 100);
  let label = "—";

  if (usage) {
    label = percentage === 0 && usage.usedTokens > 0 ? "<1%" : `${percentage}%`;
  }

  const nearLimit = !!usage && usage.usedTokens >= usage.triggerTokens;
  const action = hasCatalog ? "Choose model and show details" : "Show details";
  const triggerLabel = usage
    ? `${model}. Estimated context usage ${label}. ${action}`
    : `${model}. ${action}`;

  const selectionDisabled = disabled || !selectable;
  let selectionHelp = "Applies to the next message in this conversation.";

  if (modelSwitching) {
    selectionHelp = "Changing model…";
  } else if (selectionDisabled) {
    selectionHelp =
      "Wait for conversation work to finish before changing models.";
  }

  async function changeModel(selection: string) {
    if (selectionDisabled || selection === effectiveModelId) {
      return;
    }

    setSelectionError(null);

    try {
      await selectModel(selection);
      setOpen(false);
    } catch (error) {
      setSelectionError(
        error instanceof Error
          ? error.message
          : "Model selection is unavailable",
      );
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        setSelectionError(null);
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              type="button"
              className="workspace-toolbar-button h-10 min-w-0 shrink gap-2 px-2.5"
              aria-label={triggerLabel}
            >
              <svg
                viewBox="0 0 24 24"
                className={`size-4 shrink-0 ${nearLimit ? "text-amber-600" : "text-muted"}`}
                fill="none"
                aria-hidden="true"
              >
                <circle
                  cx="12"
                  cy="12"
                  r="9"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  className="opacity-20"
                />
                <circle
                  cx="12"
                  cy="12"
                  r="9"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeDasharray={2 * Math.PI * 9}
                  strokeDashoffset={2 * Math.PI * 9 * (1 - Math.min(ratio, 1))}
                  className="motion-context-ring"
                  transform="rotate(-90 12 12)"
                />
              </svg>
              <span className="max-w-44 truncate text-xs font-medium">
                {model}
              </span>
              {hasCatalog && (
                <CaretDownIcon
                  size={12}
                  className="shrink-0 text-muted"
                  aria-hidden="true"
                />
              )}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>
          {usage ? `${model} · Context ${label}` : model}
        </TooltipContent>
      </Tooltip>

      <PopoverContent
        align="end"
        side="top"
        sideOffset={8}
        collisionPadding={16}
        className="motion-popover z-50 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-line bg-surface p-5 text-ink shadow-lg outline-none"
        aria-label="Context usage details"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">
            {hasCatalog ? "Model" : "Context window"}
          </h2>
          <PopoverClose asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 rounded-lg"
              aria-label="Close context details"
            >
              <XIcon size={16} aria-hidden="true" />
            </Button>
          </PopoverClose>
        </div>
        {hasCatalog && (
          <div className="mb-3 space-y-3 border-b border-line pb-4">
            <RadioGroup
              value={effectiveModelId ?? ""}
              onValueChange={(selection) => void changeModel(selection)}
              disabled={selectionDisabled}
              aria-label="Conversation model"
            >
              {models.map((option) => (
                <label
                  key={option.id}
                  htmlFor={`${groupId}-${option.id}`}
                  className={`flex items-center gap-3 rounded-md px-3 py-2.5 ${
                    option.id === effectiveModelId
                      ? "bg-selected"
                      : "hover:bg-sidebar"
                  } ${selectionDisabled || !option.available ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
                >
                  <RadioGroupItem
                    id={`${groupId}-${option.id}`}
                    value={option.id}
                    disabled={!option.available}
                    aria-label={option.label}
                  />
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="block font-medium">{option.label}</span>
                    <span className="block text-xs text-muted">
                      {option.model}
                    </span>
                    {!option.available && (
                      <span className="block text-xs text-muted">
                        Not configured
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </RadioGroup>
            <p className="text-xs/relaxed text-muted">{selectionHelp}</p>
            {selectionError && (
              <p role="alert" className="text-xs/relaxed text-destructive">
                {selectionError}
              </p>
            )}
          </div>
        )}
        {hasCatalog && (
          <h3 className="mb-3 text-sm font-semibold">Context window</h3>
        )}
        {usage ? (
          <ContextDetails usage={usage} />
        ) : (
          <p className="text-sm/relaxed text-muted">
            Context usage appears after the first model call.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}

function ContextDetails({ usage }: { usage: ContextUsage }) {
  const percentage = Math.round((usage.usedTokens / usage.contextWindow) * 100);

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-1 truncate text-xs text-soft">{usage.model}</p>
        <p className="text-xl font-semibold tracking-tight tabular-nums">
          ~{compactNumber.format(usage.usedTokens)}
          <span className="ml-1 text-sm font-normal text-muted">
            / {compactNumber.format(usage.contextWindow)} tokens
          </span>
        </p>
        <Progress
          className="mt-3 h-2 bg-sidebar"
          value={Math.min(usage.usedTokens, usage.contextWindow)}
          max={usage.contextWindow}
          aria-label="Estimated context usage"
          aria-valuetext={`Approximately ${percentage}% used`}
        />
        <p className="mt-2 text-xs text-soft">
          Auto-compacts at{" "}
          {Math.round((usage.triggerTokens / usage.contextWindow) * 100)}%.
        </p>
      </div>

      <div className="border-t border-line pt-4">
        <p className="mb-3 text-[11px] font-semibold tracking-wide text-soft uppercase">
          Estimated breakdown
        </p>
        <dl className="space-y-3">
          {categories.map(({ key, label, color }) => {
            const tokens = usage.breakdown[key];
            const width = usage.usedTokens
              ? (tokens / usage.usedTokens) * 100
              : 0;

            return (
              <div key={key}>
                <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                  <dt className="flex items-center gap-2 text-muted">
                    <span
                      className={`size-2 rounded-full ${color}`}
                      aria-hidden="true"
                    />
                    {label}
                  </dt>
                  <dd className="tabular-nums">{tokenNumber.format(tokens)}</dd>
                </div>
                <div
                  className="ml-4 h-1 overflow-hidden rounded-full bg-sidebar"
                  aria-hidden="true"
                >
                  <div
                    className={`motion-progress h-full origin-left rounded-full ${color}`}
                    style={{ transform: `scaleX(${width / 100})` }}
                  />
                </div>
              </div>
            );
          })}
        </dl>
      </div>

      <div className="space-y-2 border-t border-line pt-4 text-xs/relaxed text-muted">
        {usage.lastInputTokens !== null && (
          <p>
            Last request input:{" "}
            <span className="font-medium text-ink tabular-nums">
              {tokenNumber.format(usage.lastInputTokens)}
            </span>{" "}
            tokens, reported by the provider.
          </p>
        )}
        {usage.compactions > 0 && (
          <p>
            Compacted {usage.compactions}{" "}
            {usage.compactions === 1 ? "time" : "times"}.
            {usage.lastCompaction && (
              <span className="ml-1 tabular-nums">
                Last: ~{compactNumber.format(usage.lastCompaction.beforeTokens)}{" "}
                → ~{compactNumber.format(usage.lastCompaction.afterTokens)}{" "}
                tokens.
              </span>
            )}
          </p>
        )}
        <p className="text-soft">
          The model uses a summary of older messages. Your full chat stays
          available.
        </p>
      </div>
    </div>
  );
}
