import type { Message } from "@ag-ui/client";
import type { ReactNode } from "react";
import { StackIcon } from "@phosphor-icons/react";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import {
  Message as ConversationMessage,
  MessageAvatar,
  MessageContent,
} from "@/components/ui/message";
import { hasMessageText, messageText } from "../../model/presentation";
import MarkdownMessage from "./MarkdownMessage";

export function MessageRow({
  message,
  streaming = false,
}: {
  message: Message;
  streaming?: boolean;
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
            <BubbleContent className="rounded-lg border-line px-4 py-3 text-[15px]/7 whitespace-pre-wrap">
              {text}
            </BubbleContent>
          </Bubble>
        </MessageContent>
      </ConversationMessage>
    );
  }

  return (
    <AssistantFrame>
      <AssistantText message={message} streaming={streaming} />
    </AssistantFrame>
  );
}

export function AssistantFrame({ children }: { children: ReactNode }) {
  return (
    <ConversationMessage className="gap-0" aria-label="Assistant reply">
      <MessageAvatar className="absolute top-0.5 -left-12 hidden size-8 self-start rounded-md bg-sidebar text-ink sm:flex">
        <StackIcon size={18} aria-hidden="true" />
      </MessageAvatar>
      <MessageContent className="pt-0.5">{children}</MessageContent>
    </ConversationMessage>
  );
}

export function AssistantText({
  message,
  streaming = false,
}: {
  message: Message;
  streaming?: boolean;
}) {
  return (
    <Bubble variant="ghost" className="w-full">
      <BubbleContent className="chat-markdown w-full overflow-visible text-ink">
        <MarkdownMessage
          key={message.id}
          text={messageText(message)}
          streaming={streaming}
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
