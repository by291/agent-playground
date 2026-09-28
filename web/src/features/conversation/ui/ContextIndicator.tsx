import * as Popover from "@radix-ui/react-popover";
import { XIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { useConversation } from "../ConversationProvider";
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

export function ContextIndicator() {
  const usage = useConversation((state) => state.contextUsage);
  const ratio = usage ? usage.usedTokens / usage.contextWindow : 0;
  const percentage = Math.round(ratio * 100);
  let label = "—";

  if (usage) {
    label = percentage === 0 && usage.usedTokens > 0 ? "<1%" : `${percentage}%`;
  }

  const nearLimit = !!usage && usage.usedTokens >= usage.triggerTokens;

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button
          variant="ghost"
          type="button"
          className="workspace-toolbar-button h-10 gap-1.5 px-2 sm:gap-2 sm:px-3"
          aria-label={
            usage
              ? `Estimated context usage ${label}. Show details`
              : "Show context usage"
          }
        >
          <svg
            viewBox="0 0 24 24"
            className={`size-5 shrink-0 ${nearLimit ? "text-amber-600" : "text-muted"}`}
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
              transform="rotate(-90 12 12)"
            />
          </svg>
          <span className="hidden text-xs sm:inline">Context</span>
          <span className="text-xs tabular-nums">{label}</span>
        </Button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          collisionPadding={16}
          className="z-50 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-line bg-surface p-5 text-ink shadow-lg outline-none"
          aria-label="Context usage details"
        >
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">Context window</h2>
            <Popover.Close asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 rounded-lg"
                aria-label="Close context details"
              >
                <XIcon size={16} aria-hidden="true" />
              </Button>
            </Popover.Close>
          </div>
          {usage ? (
            <ContextDetails usage={usage} />
          ) : (
            <p className="text-sm/relaxed text-muted">
              Context usage appears after the first model call.
            </p>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function ContextDetails({ usage }: { usage: ContextUsage }) {
  const ratio = usage.usedTokens / usage.contextWindow;
  const percentage = Math.round(ratio * 100);

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
        <div
          className="mt-3 h-2 overflow-hidden rounded-full bg-sidebar"
          role="progressbar"
          aria-label="Estimated context usage"
          aria-valuemin={0}
          aria-valuemax={usage.contextWindow}
          aria-valuenow={Math.min(usage.usedTokens, usage.contextWindow)}
          aria-valuetext={`Approximately ${percentage}% used`}
        >
          <div
            className="h-full rounded-full bg-accent"
            style={{ width: `${Math.min(ratio, 1) * 100}%` }}
          />
        </div>
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
                    className={`h-full rounded-full ${color}`}
                    style={{ width: `${width}%` }}
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
