import { ArrowUpIcon } from "@phosphor-icons/react";
import { useRef, useState, type KeyboardEvent, type SubmitEvent } from "react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
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
        <form onSubmit={submit}>
          <InputGroup className="h-auto flex-col items-stretch gap-1 rounded-[22px] border-line bg-white p-3 shadow-[0_8px_32px_rgba(28,41,34,0.08)] focus-within:border-accent-line sm:p-4">
            <InputGroupTextarea
              ref={input}
              rows={1}
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
              className="max-h-48 min-h-12 px-1 py-3 text-base/6"
            />
            <InputGroupAddon
              align="block-end"
              className="justify-between gap-3 px-1 pb-0"
            >
              <InputGroupText className="hidden text-[11px] text-soft sm:inline">
                Enter to send · Shift + Enter for a new line
              </InputGroupText>
              <InputGroupText className="text-[11px] text-soft sm:hidden">
                Ask anything
              </InputGroupText>
              <InputGroupButton
                type="submit"
                variant="default"
                size="icon-sm"
                disabled={running || waitingForReview || !prompt.trim()}
                aria-label={
                  waitingForReview
                    ? "Review the plan to continue"
                    : running
                      ? "Agent is responding"
                      : "Send message"
                }
                className="size-11 rounded-xl"
              >
                <ArrowUpIcon size={19} weight="bold" aria-hidden="true" />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </form>
        <p className="mt-3 hidden text-center text-[11px] text-soft sm:block">
          Responses may be inaccurate. Verify important information.
        </p>
      </div>
    </div>
  );
}
