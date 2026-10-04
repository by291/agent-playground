import { composerState } from "../model/selectors";
import { ArrowUpIcon } from "@phosphor-icons/react";
import { type KeyboardEvent, type SubmitEvent } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { useConversation } from "../ConversationProvider";
import { useReplyPresentationBusy } from "./ReplyPresentation";
import { ContextIndicator } from "./ContextIndicator";
import { useUserPreferences } from "@/lib/preferences";

export function Composer({
  prompt,
  onPromptChange,
}: {
  prompt: string;
  onPromptChange: (prompt: string) => void;
}) {
  const { preferences } = useUserPreferences();
  const { running, recovering, waitingForReview, discussingSql, onSend } =
    useConversation(useShallow(composerState));
  const presenting = useReplyPresentationBusy();
  const responding = running || presenting;
  const disabled = responding || recovering || waitingForReview;

  let placeholder = "Describe a task or ask a question…";
  let sendLabel = responding ? "Agent is responding" : "Send message";

  if (recovering) {
    sendLabel = "Restoring conversation";
  } else if (waitingForReview && !running) {
    placeholder = "Review the plan above to continue";
    sendLabel = "Review the plan to continue";
  } else if (discussingSql) {
    placeholder = "Ask about this SQL or describe a change…";
  }

  function submit(event?: SubmitEvent<HTMLFormElement>) {
    event?.preventDefault();

    if (!prompt.trim() || disabled) {
      return;
    }

    const message = prompt;

    onPromptChange("");
    void onSend(message);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const modifierPressed = event.ctrlKey || event.metaKey;
    const shortcutMatches =
      preferences.sendShortcut === "enter" || modifierPressed;

    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.altKey &&
      !event.nativeEvent.isComposing &&
      shortcutMatches
    ) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <div className="shrink-0 bg-surface px-4 pt-3 pb-4 sm:px-8 sm:pb-5">
      <div className="conversation-layout conversation-column">
        <form onSubmit={submit}>
          <InputGroup className="h-auto flex-col items-stretch gap-1 rounded-xl border-line bg-surface p-3 shadow-[0_3px_12px_rgba(32,36,44,0.04)] transition-colors duration-150 focus-within:border-accent sm:p-4">
            <InputGroupTextarea
              rows={1}
              value={prompt}
              onChange={(event) => onPromptChange(event.target.value)}
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
              <InputGroupText className="hidden min-w-0 truncate text-[11px] text-soft sm:block">
                {preferences.sendShortcut === "enter"
                  ? "Enter to send · Shift + Enter for a new line"
                  : "Ctrl/Cmd + Enter to send · Enter for a new line"}
              </InputGroupText>
              <div className="ml-auto flex min-w-0 items-center gap-2">
                <ContextIndicator />
                <InputGroupButton
                  type="submit"
                  variant="default"
                  size="icon-sm"
                  disabled={disabled || !prompt.trim()}
                  aria-label={sendLabel}
                  className="size-10 rounded-md"
                >
                  <ArrowUpIcon size={19} weight="bold" aria-hidden="true" />
                </InputGroupButton>
              </div>
            </InputGroupAddon>
          </InputGroup>
        </form>
        <p className="mt-3 hidden text-center text-[11px] text-soft sm:block">
          Review important information before acting.
        </p>
      </div>
    </div>
  );
}
