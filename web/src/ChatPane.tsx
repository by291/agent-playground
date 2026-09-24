import type { Message } from "@ag-ui/client";
import {
  ArrowRightIcon,
  ArrowUpIcon,
  ChatCircleDotsIcon,
  ClockIcon,
  SparkleIcon,
} from "@phosphor-icons/react";
import {
  Suspense,
  lazy,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type SubmitEvent,
} from "react";

const MarkdownMessage = lazy(() => import("./MarkdownMessage"));

interface ChatPaneProps {
  messages: Message[];
  running: boolean;
  onSend: (message: string) => Promise<void>;
}

export function ChatPane({ messages, running, onSend }: ChatPaneProps) {
  const scroll = useRef<HTMLDivElement>(null);
  const followOutput = useRef(true);
  const visible = messages.filter(
    (message) => message.role === "user" || message.role === "assistant",
  );

  useEffect(() => {
    if (followOutput.current && scroll.current) {
      scroll.current.scrollTop = scroll.current.scrollHeight;
    }
  }, [messages, running]);

  function updateScrollPosition() {
    const element = scroll.current;
    if (!element) return;
    followOutput.current =
      element.scrollHeight - element.scrollTop - element.clientHeight < 100;
  }

  return (
    <>
      <div
        ref={scroll}
        onScroll={updateScrollPosition}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        <div className="mx-auto flex min-h-full w-full max-w-205 flex-col px-4 sm:px-8">
          {visible.length === 0 ? (
            <Welcome onSend={onSend} />
          ) : (
            <div className="space-y-8 pt-8 pb-12 sm:pt-12">
              {visible.map((message) => (
                <MessageRow key={message.id} message={message} />
              ))}
              {running && visible.at(-1)?.role === "user" && <Thinking />}
            </div>
          )}
        </div>
      </div>
      <Composer running={running} onSend={onSend} />
    </>
  );
}

function Welcome({ onSend }: { onSend: ChatPaneProps["onSend"] }) {
  return (
    <div className="my-auto w-full py-12 sm:py-20">
      <div className="mb-7 flex size-12 items-center justify-center rounded-2xl border border-accent-line bg-accent-soft text-accent shadow-[0_8px_20px_rgba(49,94,69,0.06)]">
        <SparkleIcon size={25} weight="fill" aria-hidden="true" />
      </div>
      <p className="mb-3 text-[11px] font-semibold tracking-[0.16em] text-accent uppercase">
        Your agent workspace
      </p>
      <h2 className="max-w-xl text-[30px] leading-[1.15] font-semibold tracking-[-0.055em] text-ink sm:text-[38px]">
        A place to think out loud.
      </h2>
      <p className="mt-4 max-w-lg text-[15px]/7 text-muted">
        Ask a question, try a tool call, or explore what happens during an agent
        run.
      </p>

      <div className="mt-10 grid gap-3 sm:grid-cols-2">
        <Suggestion
          icon={<ChatCircleDotsIcon size={21} aria-hidden="true" />}
          title="Start a conversation"
          prompt="What can you help me with?"
          onSend={onSend}
        />
        <Suggestion
          icon={<ClockIcon size={21} aria-hidden="true" />}
          title="Try the time tool"
          prompt="What time is it in UTC right now?"
          onSend={onSend}
        />
      </div>
    </div>
  );
}

function Suggestion({
  icon,
  title,
  prompt,
  onSend,
}: {
  icon: React.ReactNode;
  title: string;
  prompt: string;
  onSend: ChatPaneProps["onSend"];
}) {
  return (
    <button
      type="button"
      onClick={() => void onSend(prompt)}
      className="group flex min-h-28 flex-col justify-between rounded-2xl border border-line bg-white p-4 text-left shadow-[0_2px_8px_rgba(28,41,34,0.025)] transition-[border-color,box-shadow] hover:border-accent-line hover:shadow-[0_8px_24px_rgba(28,41,34,0.06)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <div className="flex w-full items-start justify-between text-accent">
        {icon}
        <ArrowRightIcon
          size={17}
          className="text-soft transition-transform group-hover:translate-x-0.5 group-hover:text-accent"
          aria-hidden="true"
        />
      </div>
      <div>
        <p className="text-[13px] font-semibold text-ink">{title}</p>
        <p className="mt-1 text-xs text-muted">{prompt}</p>
      </div>
    </button>
  );
}

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

function MessageRow({ message }: { message: Message }) {
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

function Thinking() {
  return (
    <div className="flex items-center gap-4 text-sm text-muted" role="status">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
        <SparkleIcon size={18} weight="fill" aria-hidden="true" />
      </div>
      <span className="animate-pulse">Thinking…</span>
    </div>
  );
}

function Composer({
  running,
  onSend,
}: Pick<ChatPaneProps, "running" | "onSend">) {
  const [prompt, setPrompt] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);

  function submit(event?: SubmitEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!prompt.trim() || running) return;
    const message = prompt;
    setPrompt("");
    void onSend(message).finally(() => input.current?.focus());
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <div className="shrink-0 bg-white px-4 pt-3 pb-4 sm:px-8 sm:pb-6">
      <div className="mx-auto w-full max-w-205">
        <form
          onSubmit={submit}
          className="rounded-[22px] border border-line bg-white p-3 shadow-[0_8px_32px_rgba(28,41,34,0.08)] transition-colors focus-within:border-accent-line sm:p-4"
        >
          <textarea
            ref={input}
            rows={2}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message Agent Playground"
            aria-label="Message"
            disabled={running}
            className="max-h-48 min-h-14 w-full resize-none bg-transparent p-1 text-base/6 text-ink outline-none placeholder:text-soft disabled:cursor-wait disabled:opacity-60"
          />
          <div className="flex items-center justify-between gap-3 pl-1">
            <span className="hidden text-[11px] text-soft sm:block">
              Enter to send · Shift + Enter for a new line
            </span>
            <span className="text-[11px] text-soft sm:hidden">
              Ask anything
            </span>
            <button
              type="submit"
              disabled={running || !prompt.trim()}
              aria-label={running ? "Agent is responding" : "Send message"}
              className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-white transition-colors hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:bg-line disabled:text-soft"
            >
              <ArrowUpIcon size={19} weight="bold" aria-hidden="true" />
            </button>
          </div>
        </form>
        <p className="mt-3 hidden text-center text-[11px] text-soft sm:block">
          Responses may be inaccurate. Verify important information.
        </p>
      </div>
    </div>
  );
}
