import { useEffect, useState } from "react";
import { CopyIcon } from "@phosphor-icons/react/dist/csr/Copy";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { Button } from "@/components/ui/button";

export function MessageTimestamp({
  timestamp,
  className = "",
}: {
  timestamp?: string | undefined;
  className?: string;
}) {
  const date = timestamp ? new Date(timestamp) : null;

  if (!date || Number.isNaN(date.getTime())) {
    return null;
  }

  const label = new Intl.DateTimeFormat(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);

  return (
    <time
      dateTime={timestamp}
      title={date.toLocaleString()}
      className={`text-xs text-muted select-none ${className}`}
    >
      {label}
    </time>
  );
}

export function AssistantMessageFooter({
  markdown,
  timestamp,
  disabled,
}: {
  markdown: string;
  timestamp?: string | undefined;
  disabled: boolean;
}) {
  const [feedback, setFeedback] = useState<{
    markdown: string;
    status: "copied" | "failed";
  } | null>(null);
  const status = feedback?.markdown === markdown ? feedback.status : null;

  useEffect(() => {
    if (!feedback) {
      return;
    }

    const timeout = setTimeout(() => setFeedback(null), 1800);

    return () => clearTimeout(timeout);
  }, [feedback]);

  async function copyReply() {
    try {
      await navigator.clipboard.writeText(markdown);
      setFeedback({ markdown, status: "copied" });
    } catch {
      setFeedback({ markdown, status: "failed" });
    }
  }

  const copied = status === "copied";
  let feedbackMessage = "";

  if (status === "failed") {
    feedbackMessage = "Could not copy. Try again.";
  } else if (copied) {
    feedbackMessage = "Copied";
  }

  return (
    <div className="flex min-h-8 items-center gap-2 text-muted select-none">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-11 sm:size-8"
        aria-label={copied ? "Copied" : "Copy all"}
        title={copied ? "Copied" : "Copy all"}
        disabled={disabled}
        onClick={() => void copyReply()}
      >
        {copied ? (
          <CheckIcon aria-hidden="true" />
        ) : (
          <CopyIcon aria-hidden="true" />
        )}
      </Button>
      <MessageTimestamp timestamp={timestamp} />
      <span
        role="status"
        className={status === "failed" ? "text-xs text-destructive" : "sr-only"}
      >
        {feedbackMessage}
      </span>
    </div>
  );
}
