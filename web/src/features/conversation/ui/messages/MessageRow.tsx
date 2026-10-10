import type { Message } from "@ag-ui/client";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { StackIcon } from "@phosphor-icons/react/dist/csr/Stack";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Spinner } from "@/components/ui/spinner";
import {
  Message as ConversationMessage,
  MessageAvatar,
  MessageContent,
} from "@/components/ui/message";
import { hasMessageText, messageText } from "../../model/presentation";
import MarkdownMessage from "./MarkdownMessage";
import { uploadedMessageContent } from "@shared/uploaded-files";
import { UploadedAttachments } from "../Attachments";
import { AssistantMessageFooter, MessageTimestamp } from "./MessageMetadata";
import { copyMarkdownSelection } from "./markdownSelection";

export function MessageRow({
  message,
  streaming = false,
  threadId,
  timestamp,
}: {
  message: Message;
  streaming?: boolean;
  threadId?: string | null;
  timestamp?: string | undefined;
}) {
  const text = messageText(message);

  if (!hasMessageText(message)) {
    return null;
  }

  if (message.role === "user") {
    const content = uploadedMessageContent(text);

    return (
      <ConversationMessage align="end">
        <MessageContent>
          {content.text.trim() && (
            <Bubble
              variant="secondary"
              align="end"
              className="max-w-[85%] sm:max-w-[75%]"
            >
              <BubbleContent className="rounded-lg border-line px-4 py-3 text-[15px]/7 whitespace-pre-wrap">
                {content.text}
              </BubbleContent>
            </Bubble>
          )}
          {threadId && content.files.length > 0 && (
            <UploadedAttachments threadId={threadId} files={content.files} />
          )}
          <MessageTimestamp timestamp={timestamp} className="self-end" />
        </MessageContent>
      </ConversationMessage>
    );
  }

  return (
    <AssistantFrame>
      <AssistantText
        message={message}
        streaming={streaming}
        settled={!streaming}
        timestamp={timestamp}
      />
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

function hasRenderedAnswerText(element: HTMLElement): boolean {
  const textNodes = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);

  while (textNodes.nextNode()) {
    const node = textNodes.currentNode;
    const chrome = node.parentElement?.closest(
      'button, [hidden], [aria-hidden="true"], [data-streamdown="code-block-header"], [data-streamdown="code-block-actions"]',
    );

    if (node.textContent?.trim() && !chrome) {
      return true;
    }
  }

  return false;
}

export function AssistantText({
  message,
  streaming = false,
  onTextVisible,
  settled = true,
  timestamp,
}: {
  message: Message;
  streaming?: boolean;
  onTextVisible?: (messageId: string) => void;
  settled?: boolean;
  timestamp?: string | undefined;
}) {
  const content = useRef<HTMLDivElement>(null);
  const [displaying, setDisplaying] = useState(streaming);
  const markdown = messageText(message);

  useLayoutEffect(() => {
    const element = content.current;

    if (!element || !onTextVisible) {
      return;
    }

    // Markdown rendering can commit after its paced buffer changes. Observe
    // actual rendered text so an empty presentation does not hide reasoning.
    const observer = new MutationObserver(reportVisibleText);

    function reportVisibleText() {
      if (hasRenderedAnswerText(element!)) {
        onTextVisible!(message.id);
        observer.disconnect();
      }
    }

    observer.observe(element, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    reportVisibleText();

    return () => observer.disconnect();
  }, [message.id, onTextVisible]);

  return (
    <div className="space-y-1">
      <Bubble variant="ghost" className="w-full">
        <BubbleContent
          ref={content}
          className="chat-markdown w-full overflow-visible text-ink"
          onCopy={copyMarkdownSelection}
        >
          <MarkdownMessage
            key={message.id}
            text={markdown}
            streaming={streaming}
            onStreamingChange={setDisplaying}
          />
        </BubbleContent>
      </Bubble>
      <AssistantMessageFooter
        markdown={markdown}
        timestamp={timestamp}
        disabled={!settled || displaying}
      />
    </div>
  );
}

export function ThinkingStatus({ label = "Thinking" }: { label?: string }) {
  return (
    <div
      className="flex min-h-8 items-center gap-2 text-sm text-muted"
      role="status"
    >
      <Spinner aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
