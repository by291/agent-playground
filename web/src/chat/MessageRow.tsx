import type { Message } from "@ag-ui/client";
import { SparkleIcon } from "@phosphor-icons/react";
import { lazy, Suspense } from "react";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import {
  Message as ConversationMessage,
  MessageAvatar,
  MessageContent,
} from "@/components/ui/message";

const MarkdownMessage = lazy(() => import("./MarkdownMessage"));

function messageText(message: Message): string {
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  const parts: unknown[] = message.content;
  return parts
    .filter(
      (part): part is { type: "text"; text: string } =>
        typeof part === "object" &&
        part !== null &&
        "type" in part &&
        part.type === "text" &&
        "text" in part &&
        typeof part.text === "string",
    )
    .map((part) => part.text)
    .join("\n");
}

export function MessageRow({ message }: { message: Message }) {
  const text = messageText(message);
  if (!text) return null;

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
    <ConversationMessage className="gap-3 sm:gap-4">
      <MessageAvatar className="mt-0.5 size-8 self-start rounded-xl bg-accent-soft text-accent">
        <SparkleIcon size={18} weight="fill" aria-hidden="true" />
      </MessageAvatar>
      <MessageContent className="pt-0.5">
        <Bubble variant="ghost" className="w-full">
          <BubbleContent className="chat-markdown w-full overflow-visible text-ink">
            <Suspense fallback={<p className="whitespace-pre-wrap">{text}</p>}>
              <MarkdownMessage text={text} />
            </Suspense>
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </ConversationMessage>
  );
}

export function Thinking() {
  return (
    <div className="flex items-center gap-4 text-sm text-muted" role="status">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
        <SparkleIcon size={18} weight="fill" aria-hidden="true" />
      </div>
      <span className="animate-pulse">Thinking…</span>
    </div>
  );
}
