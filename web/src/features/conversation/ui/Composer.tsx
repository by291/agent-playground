import { composerState } from "../model/selectors";
import { ArrowUpIcon } from "@phosphor-icons/react/dist/csr/ArrowUp";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type SubmitEvent,
} from "react";
import { PaperclipIcon } from "@phosphor-icons/react/dist/csr/Paperclip";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { CircleNotchIcon } from "@phosphor-icons/react/dist/csr/CircleNotch";
import { AnimatePresence } from "motion/react";
import { AnimatedDiv } from "@/components/ui/motion";
import { maxSkillFileBytes, skillFilenameSchema } from "@shared/skill-files";
import { uploadFile } from "../api/files";
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
  const [files, setFiles] = useState<{ id: string; file: File }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const upload = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => upload.current?.abort();
  }, []);

  const { preferences } = useUserPreferences();
  const {
    running,
    recovering,
    waitingForReview,
    waitingForExternalTask,
    discussionPlaceholder,
    onSend,
  } = useConversation(useShallow(composerState));
  const presenting = useReplyPresentationBusy();
  const ensureThreadId = useConversation((state) => state.ensureThreadId);
  const responding = running || presenting;
  const disabled =
    uploading ||
    responding ||
    recovering ||
    waitingForReview ||
    waitingForExternalTask;

  let placeholder = "Describe a task or ask a question…";
  let sendLabel = responding ? "Agent is responding" : "Send message";

  if (uploading) {
    sendLabel = "Uploading files";
  } else if (recovering) {
    sendLabel = "Restoring conversation";
  } else if (waitingForExternalTask && !running) {
    placeholder =
      "The external task is running. You can leave and return later.";
    sendLabel = "Waiting for external task";
  } else if (waitingForReview && !running) {
    placeholder = "Review the plan above to continue";
    sendLabel = "Review the plan to continue";
  } else if (discussionPlaceholder) {
    placeholder = discussionPlaceholder;
  }

  function submit(event?: SubmitEvent<HTMLFormElement>) {
    event?.preventDefault();

    if (!prompt.trim() || disabled) {
      return;
    }

    const message = prompt;

    if (!files.length) {
      onPromptChange("");
      void onSend(message);

      return;
    }

    if (upload.current) {
      return;
    }

    const controller = new AbortController();
    const threadId = ensureThreadId();

    upload.current = controller;
    setUploading(true);
    setUploadError(null);
    void Promise.allSettled(
      files.map(({ id, file }) =>
        uploadFile(threadId, id, file, controller.signal),
      ),
    )
      .then((results) => {
        const uploaded = results.map((result) => {
          if (result.status === "rejected") {
            throw result.reason;
          }

          return result.value;
        });

        if (controller.signal.aborted) {
          return;
        }

        const references = uploaded.map(
          (file) => `${JSON.stringify(file.name)} — File ID: ${file.id}`,
        );

        onPromptChange("");
        setFiles([]);
        void onSend(`${message}\n\nUploaded files:\n${references.join("\n")}`);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setUploadError(
            error instanceof Error
              ? error.message
              : "File upload failed. Please retry.",
          );
        }
      })
      .finally(() => {
        if (upload.current === controller) {
          upload.current = null;

          if (!controller.signal.aborted) {
            setUploading(false);
          }
        }
      });
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
          <input
            ref={picker}
            type="file"
            multiple
            className="hidden"
            aria-label="Choose files"
            disabled={disabled}
            onChange={(event) => {
              const selected = Array.from(event.target.files ?? []);

              event.target.value = "";

              if (
                files.length + selected.length > 4 ||
                selected.some(
                  (file) =>
                    file.size > maxSkillFileBytes ||
                    !skillFilenameSchema.safeParse(file.name).success,
                )
              ) {
                setUploadError(
                  "Choose at most four files, up to 10 MiB each, with valid filenames.",
                );

                return;
              }

              setUploadError(null);
              setFiles((previous) => [
                ...previous,
                ...selected.map((file) => ({
                  id: crypto.randomUUID(),
                  file,
                })),
              ]);
            }}
          />
          <InputGroup className="h-auto flex-col items-stretch gap-1 rounded-xl border-line bg-surface p-3 shadow-[0_3px_12px_rgba(32,36,44,0.04)] transition-colors duration-150 focus-within:border-accent sm:p-4">
            <div className="flex flex-wrap gap-2 px-1 empty:hidden">
              <AnimatePresence initial={false}>
                {files.map(({ id, file }) => (
                  <AnimatedDiv
                    key={id}
                    layout="position"
                    exit={{
                      opacity: 0,
                      height: 0,
                      width: 0,
                      margin: 0,
                      padding: 0,
                      borderWidth: 0,
                    }}
                    className="flex max-w-full items-center gap-2 overflow-hidden rounded-lg border border-line px-2 py-1 text-xs"
                  >
                    <span className="truncate">{file.name}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${file.name}`}
                      disabled={disabled}
                      className="rounded p-1 hover:bg-sidebar focus-visible:ring-2 focus-visible:ring-accent"
                      onClick={() =>
                        setFiles((previous) =>
                          previous.filter((item) => item.id !== id),
                        )
                      }
                    >
                      <XIcon size={14} aria-hidden="true" />
                    </button>
                  </AnimatedDiv>
                ))}
              </AnimatePresence>
            </div>
            {uploading && (
              <p
                role="status"
                className="motion-content-enter px-1 text-xs text-muted"
              >
                Uploading {files.length} {files.length === 1 ? "file" : "files"}
                …
              </p>
            )}
            {uploadError && (
              <p role="alert" className="px-1 text-sm text-red-700">
                {uploadError}
              </p>
            )}
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
              <InputGroupButton
                type="button"
                size="icon-sm"
                aria-label="Attach files"
                disabled={disabled}
                onClick={() => picker.current?.click()}
              >
                <PaperclipIcon size={18} aria-hidden="true" />
              </InputGroupButton>
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
                  {uploading || recovering || responding ? (
                    <CircleNotchIcon
                      size={19}
                      aria-hidden="true"
                      className="motion-safe:animate-spin"
                    />
                  ) : (
                    <ArrowUpIcon size={19} weight="bold" aria-hidden="true" />
                  )}
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
