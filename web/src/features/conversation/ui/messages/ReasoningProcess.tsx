import { useState } from "react";
import {
  BrainIcon,
  CaretDownIcon,
  CircleNotchIcon,
} from "@phosphor-icons/react";
import type { ReasoningMessage } from "@ag-ui/client";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import MarkdownMessage from "./MarkdownMessage";

export function ReasoningProcess({
  messages,
  active,
  thinking,
  replyId,
}: {
  messages: ReasoningMessage[];
  active: boolean;
  thinking: boolean;
  replyId: string | null;
}) {
  // Checkpoint reasoning IDs differ from the live adapter's IDs. Keep user
  // choices through recovery, and reset them only for a new reasoning or answer phase.
  const phase =
    replyId === null ? `reasoning-${messages.length}` : `reply-${replyId}`;
  const automaticOpen = active && replyId === null;
  const [fold, setFold] = useState({ phase, open: automaticOpen });

  if (fold.phase !== phase) {
    setFold({ phase, open: automaticOpen });
  }

  const open = fold.phase === phase ? fold.open : automaticOpen;

  return (
    <Collapsible
      open={open}
      onOpenChange={(open) => setFold({ phase, open })}
      className="w-full min-w-0"
    >
      <CollapsibleTrigger className="flex min-h-8 max-w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-left text-sm text-muted hover:bg-sidebar focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none">
        {thinking ? (
          <CircleNotchIcon
            size={16}
            aria-hidden="true"
            className="motion-safe:animate-spin"
          />
        ) : (
          <BrainIcon size={16} aria-hidden="true" />
        )}
        <span>{thinking ? "Thinking" : "Reasoning"}</span>
        <CaretDownIcon
          size={14}
          aria-hidden="true"
          className={open ? "rotate-180" : ""}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="chat-markdown mt-2 space-y-3 border-l border-line pl-3 text-sm text-muted">
        {messages.map((message) => (
          <MarkdownMessage
            key={message.id}
            text={message.content}
            streaming={false}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}
