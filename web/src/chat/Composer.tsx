import { ArrowUpIcon } from "@phosphor-icons/react";
import { useRef, useState, type KeyboardEvent, type SubmitEvent } from "react";
import type { ChatPaneProps } from "./types";

export function Composer({
  running,
  waitingForReview,
  onSend,
}: Pick<ChatPaneProps, "running" | "waitingForReview" | "onSend">) {
  const [prompt, setPrompt] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);

  function submit(event?: SubmitEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!prompt.trim() || running || waitingForReview) return;
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
            placeholder={
              waitingForReview
                ? "Review the plan above to continue"
                : "Message Agent Playground"
            }
            aria-label="Message"
            disabled={running || waitingForReview}
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
              disabled={running || waitingForReview || !prompt.trim()}
              aria-label={
                waitingForReview
                  ? "Review the plan to continue"
                  : running
                    ? "Agent is responding"
                    : "Send message"
              }
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
