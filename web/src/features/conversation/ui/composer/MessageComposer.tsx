import { composerState } from "../../model/selectors";
import { ArrowUpIcon } from "@phosphor-icons/react/dist/csr/ArrowUp";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type SubmitEvent,
} from "react";
import { PaperclipIcon } from "@phosphor-icons/react/dist/csr/Paperclip";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { AnimatePresence } from "motion/react";
import { AnimatedDiv } from "@/components/ui/motion";
import { maxSkillFileBytes, skillFilenameSchema } from "@shared/skill-files";
import { uploadedFileMessage } from "@shared/uploaded-files";
import { uploadFile } from "../../api/files";
import { useShallow } from "zustand/react/shallow";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { useConversation } from "../../providers/ConversationProvider";
import { useReplyPresentationBusy } from "../outputs/ReplyPresentation";
import { ContextIndicator } from "./ContextIndicator";
import {
  isImageAttachment,
  SelectedAttachment,
} from "../attachments/MessageAttachments";
import { useUserPreferences } from "@/shared/preferences/UserPreferencesProvider";

export function MessageComposer({
  prompt,
  onPromptChange,
}: {
  prompt: string;
  onPromptChange: (prompt: string) => void;
}) {
  const [files, setFiles] = useState<
    { id: string; file: File; preview?: string }[]
  >([]);
  const previews = useRef(new Map<string, string>());
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const upload = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const currentPrompt = useRef(prompt);

  useEffect(() => {
    currentPrompt.current = prompt;
  }, [prompt]);

  useEffect(() => {
    mounted.current = true;
    const ownedPreviews = previews.current;

    return () => {
      mounted.current = false;
      upload.current?.abort();

      for (const url of ownedPreviews.values()) {
        URL.revokeObjectURL(url);
      }

      ownedPreviews.clear();
    };
  }, []);

  function removeFiles(ids: Set<string>) {
    for (const id of ids) {
      const url = previews.current.get(id);

      if (url) {
        URL.revokeObjectURL(url);
        previews.current.delete(id);
      }
    }

    setFiles((previous) => previous.filter(({ id }) => !ids.has(id)));
  }

  const { preferences } = useUserPreferences();
  const {
    running,
    recovering,
    changingModel,
    waitingForReview,
    waitingForExternalTask,
    discussionPlaceholder,
    onSend,
  } = useConversation(useShallow(composerState));
  const presenting = useReplyPresentationBusy();
  const ensureThreadId = useConversation((state) => state.ensureThreadId);
  const responding = running || presenting;
  const disabled =
    submitting ||
    uploading ||
    responding ||
    recovering ||
    changingModel ||
    waitingForReview ||
    waitingForExternalTask;

  let placeholder = "Describe a task or ask a question…";
  let sendLabel = responding ? "Agent is responding" : "Send message";

  if (changingModel) {
    sendLabel = "Changing model";
  } else if (uploading) {
    sendLabel = "Uploading files";
  } else if (submitting && !responding) {
    sendLabel = "Sending message";
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

    if (upload.current) {
      return;
    }

    const controller = new AbortController();

    upload.current = controller;
    setSubmitting(true);
    setUploading(files.length > 0);
    setUploadError(null);

    const submittedFileIds = new Set(files.map(({ id }) => id));

    async function send() {
      let content = message;

      if (files.length) {
        const threadId = ensureThreadId();
        const results = await Promise.allSettled(
          files.map(({ id, file }) =>
            uploadFile(threadId, id, file, controller.signal),
          ),
        );
        const uploaded = results.map((result) => {
          if (result.status === "rejected") {
            throw result.reason;
          }

          return result.value;
        });

        if (controller.signal.aborted) {
          return;
        }

        content = uploadedFileMessage(message, uploaded);
      }

      await onSend(content, () => {
        if (!mounted.current || controller.signal.aborted) {
          return;
        }

        // Admission may arrive after a parent replaces the draft; keep the newer text.
        if (currentPrompt.current === message) {
          onPromptChange("");
        }

        removeFiles(submittedFileIds);
        setUploading(false);
        setSubmitting(false);
        setUploadError(null);
        upload.current = null;
      });
    }

    void send()
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
            setSubmitting(false);
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
              const attachments = selected.map((file) => {
                const id = crypto.randomUUID();

                if (!isImageAttachment(file.name)) {
                  return { id, file };
                }

                const preview = URL.createObjectURL(file);

                previews.current.set(id, preview);

                return { id, file, preview };
              });

              setFiles((previous) => [...previous, ...attachments]);
            }}
          />
          <InputGroup className="h-auto flex-col items-stretch gap-1 rounded-xl border-line bg-surface p-3 shadow-[0_3px_12px_rgba(32,36,44,0.04)] transition-colors duration-150 focus-within:border-accent sm:p-4">
            <div className="flex flex-wrap gap-2 px-1 empty:hidden">
              <AnimatePresence initial={false}>
                {files.map(({ id, file, preview }) => (
                  <AnimatedDiv
                    key={id}
                    data-slot="composer-attachment"
                    layout="position"
                    exit={{
                      opacity: 0,
                      height: 0,
                      width: 0,
                      margin: 0,
                      padding: 0,
                      borderWidth: 0,
                    }}
                    className="max-w-full min-w-0 overflow-hidden"
                  >
                    <SelectedAttachment
                      file={file}
                      preview={preview}
                      images={files.flatMap(
                        ({ file: imageFile, preview: imagePreview }) =>
                          imagePreview
                            ? [
                                {
                                  name: imageFile.name,
                                  alt: imageFile.name,
                                  src: imagePreview,
                                  thumbnail: imagePreview,
                                },
                              ]
                            : [],
                      )}
                      uploading={uploading}
                      disabled={disabled}
                      onRemove={() => removeFiles(new Set([id]))}
                    />
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
              <Alert variant="destructive" className="px-3 py-2">
                <AlertDescription>{uploadError}</AlertDescription>
              </Alert>
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
                {preferences.sendShortcut === "enter" ? (
                  <>
                    <Kbd>Enter</Kbd> to send · <Kbd>Shift + Enter</Kbd> for a
                    new line
                  </>
                ) : (
                  <>
                    <Kbd>Ctrl/Cmd + Enter</Kbd> to send · <Kbd>Enter</Kbd> for a
                    new line
                  </>
                )}
              </InputGroupText>
              <div className="ml-auto flex min-w-0 items-center gap-2">
                <ContextIndicator disabled={disabled} />
                <InputGroupButton
                  type="submit"
                  variant="default"
                  size="icon-sm"
                  disabled={disabled || !prompt.trim()}
                  aria-label={sendLabel}
                  className="size-10 rounded-md"
                >
                  {uploading || recovering || responding ? (
                    <Spinner aria-hidden="true" className="size-5" />
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
