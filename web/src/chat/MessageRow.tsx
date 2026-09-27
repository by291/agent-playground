import type { Message } from "@ag-ui/client";
import { SparkleIcon } from "@phosphor-icons/react";
import { lazy, Suspense } from "react";

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
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-[20px] rounded-br-md bg-sidebar px-4 py-3 text-[15px]/7 whitespace-pre-wrap text-ink sm:max-w-[75%]">
          {text}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 sm:gap-4">
      <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
        <SparkleIcon size={18} weight="fill" aria-hidden="true" />
      </div>
      <div className="chat-markdown min-w-0 flex-1 pt-0.5">
        <Suspense fallback={<p className="whitespace-pre-wrap">{text}</p>}>
          <MarkdownMessage text={text} />
        </Suspense>
      </div>
    </div>
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
