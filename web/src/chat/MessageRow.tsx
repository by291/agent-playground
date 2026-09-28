import type { Message } from "@ag-ui/client";
import type { ReactNode } from "react";
import { SparkleIcon } from "@phosphor-icons/react";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import {
  Message as ConversationMessage,
  MessageAvatar,
  MessageContent,
} from "@/components/ui/message";
import { hasMessageText, messageText } from "./presentation";
import MarkdownMessage from "./MarkdownMessage";

export function MessageRow({
  message,
  smoothText = false,
}: {
  message: Message;
  smoothText?: boolean;
}) {
  const text = messageText(message);

  if (!hasMessageText(message)) {
    return null;
  }

  if (message.role === "user") {
    return (
      <ConversationMessage align="end">
        <MessageContent>
          <Bubble
            variant="secondary"
            align="end"
            className="max-w-[85%] sm:max-w-[75%]"
          >
            <BubbleContent className="rounded-[20px] rounded-br-md px-4 py-3 text-[15px]/7 whitespace-pre-wrap">
              {text}
            </BubbleContent>
          </Bubble>
        </MessageContent>
      </ConversationMessage>
    );
  }

  return (
    <AssistantFrame>
      <AssistantText message={message} smoothText={smoothText} />
    </AssistantFrame>
  );
}

export function AssistantFrame({ children }: { children: ReactNode }) {
  return (
    <ConversationMessage
      className="gap-3 sm:gap-4"
      aria-label="Assistant reply"
    >
      <MessageAvatar className="mt-0.5 size-8 self-start rounded-xl bg-accent-soft text-accent">
        <SparkleIcon size={18} weight="fill" aria-hidden="true" />
      </MessageAvatar>
      <MessageContent className="pt-0.5">{children}</MessageContent>
    </ConversationMessage>
  );
}

export function AssistantText({
  message,
  smoothText = false,
}: {
  message: Message;
  smoothText?: boolean;
}) {
  return (
    <Bubble variant="ghost" className="w-full">
      <BubbleContent className="chat-markdown w-full overflow-visible text-ink">
        <MarkdownMessage
          key={message.id}
          text={messageText(message)}
          animate={smoothText}
        />
      </BubbleContent>
    </Bubble>
  );
}

export function ThinkingStatus({ label = "Thinking" }: { label?: string }) {
  return (
    <div
      className="flex min-h-8 items-center gap-2 text-sm text-muted"
      role="status"
    >
      <span>{label}</span>
      <span className="flex items-center gap-1" aria-hidden="true">
        <span className="thinking-dot" />
        <span className="thinking-dot" />
        <span className="thinking-dot" />
      </span>
    </div>
  );
}
