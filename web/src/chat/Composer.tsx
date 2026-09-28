import { ArrowUpIcon } from "@phosphor-icons/react";
import { useRef, useState, type KeyboardEvent, type SubmitEvent } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { useConversation } from "../conversation/useConversation";

export function Composer() {
  const { running, recovering, waitingForReview, onSend } = useConversation(
    useShallow((state) => ({
      running: state.running,
      recovering: state.recovering,
      waitingForReview: state.pendingInterrupts.length > 0,
      onSend: state.send,
    })),
  );
  const disabled = running || recovering || waitingForReview;
  const [prompt, setPrompt] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);

  let placeholder = "Message Agent Playground";
  let sendLabel = running ? "Agent is responding" : "Send message";

  if (recovering) {
    sendLabel = "Restoring conversation";
  } else if (waitingForReview) {
    placeholder = "Review the plan above to continue";
    sendLabel = "Review the plan to continue";
  }

  function submit(event?: SubmitEvent<HTMLFormElement>) {
    event?.preventDefault();

    if (!prompt.trim() || disabled) {
      return;
    }

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
          <InputGroup className="h-auto flex-col items-stretch gap-1 rounded-[22px] border-line bg-white p-3 shadow-[0_8px_32px_rgba(28,41,34,0.08)] transition-[border-color,box-shadow] duration-200 focus-within:border-accent-line focus-within:shadow-[0_10px_36px_rgba(49,94,69,0.13)] sm:p-4">
            <InputGroupTextarea
              ref={input}
              rows={1}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              aria-label="Message"
              disabled={disabled}
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
                disabled={disabled || !prompt.trim()}
                aria-label={sendLabel}
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
