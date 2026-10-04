import { useRef, useState, type SubmitEvent } from "react";
import * as Popover from "@radix-ui/react-popover";
import {
  DotsThreeIcon,
  PencilSimpleIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "cn";
import { conversationTitleSchema } from "@shared/conversation";
import type { ConversationHistory } from "../model/useConversationHistory";

export function ConversationActions({
  threadId,
  title,
  deletionBlocked,
  history,
}: {
  threadId: string;
  title: string;
  deletionBlocked: boolean;
  history: ConversationHistory;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"actions" | "rename" | "delete">("actions");
  const [draft, setDraft] = useState(title);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(
    null,
  );
  const actionLabel =
    mode === "rename" ? "Rename conversation" : "Delete conversation";
  let submitLabel = mode === "rename" ? "Save title" : "Delete conversation";

  if (pending) {
    submitLabel = "Saving…";
  }

  function changeOpen(next: boolean) {
    if (pending) {
      return;
    }

    setOpen(next);

    if (next) {
      // A body portal is inert behind the mobile navigation's native modal dialog.
      setPortalContainer(trigger.current?.closest("dialog") ?? null);
      setMode("actions");
      setDraft(title);
      setError(null);
      history.refresh();
    }
  }

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();

    if (pending) {
      return;
    }

    const parsed = conversationTitleSchema.safeParse(draft);

    if (mode === "rename" && !parsed.success) {
      setError("Enter a title between 1 and 100 characters.");

      return;
    }

    setPending(true);
    setError(null);

    try {
      if (mode === "rename" && parsed.success) {
        await history.rename(threadId, parsed.data);
      } else if (mode === "delete") {
        await history.remove(threadId);
      }

      setOpen(false);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Conversation update failed",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={changeOpen} modal>
      <Popover.Trigger asChild>
        <Button
          ref={trigger}
          type="button"
          variant="ghost"
          size="icon"
          className="workspace-toolbar-button size-8 shrink-0"
          aria-label={`Actions for ${title}`}
        >
          <DotsThreeIcon size={20} aria-hidden="true" />
        </Button>
      </Popover.Trigger>
      <Popover.Portal container={portalContainer ?? undefined}>
        <Popover.Content
          side={portalContainer ? "bottom" : "right"}
          align={portalContainer ? "end" : "start"}
          sideOffset={6}
          collisionPadding={12}
          aria-label={mode === "actions" ? "Conversation actions" : actionLabel}
          className={cn(
            "z-50 max-w-[calc(100vw-1.5rem)] rounded-lg border border-line bg-surface text-sm text-ink shadow-md",
            mode === "actions" ? "w-44 p-1" : "w-56 p-3 sm:w-72",
          )}
        >
          {mode === "actions" ? (
            <div className="flex flex-col gap-0.5">
              <Button
                type="button"
                variant="ghost"
                className="h-11 justify-start gap-2 rounded-md px-2.5 font-normal focus-visible:border-muted focus-visible:bg-selected focus-visible:ring-0 sm:h-8"
                onClick={() => setMode("rename")}
              >
                <PencilSimpleIcon aria-hidden="true" />
                Rename
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="h-11 justify-start gap-2 rounded-md px-2.5 font-normal text-destructive focus-visible:border-muted focus-visible:bg-selected focus-visible:ring-0 sm:h-8"
                disabled={deletionBlocked}
                onClick={() => setMode("delete")}
              >
                <TrashIcon aria-hidden="true" />
                Delete
              </Button>
              {deletionBlocked && (
                <p className="px-2 pt-1 text-xs text-muted">
                  Wait for the run to finish before deleting.
                </p>
              )}
            </div>
          ) : (
            <form
              onSubmit={(event) => {
                void submit(event);
              }}
              className="space-y-3"
            >
              {mode === "rename" ? (
                <label className="block space-y-2">
                  <span className="font-medium">Conversation title</span>
                  <Input
                    value={draft}
                    disabled={pending}
                    onChange={(event) => setDraft(event.target.value)}
                    autoFocus
                  />
                </label>
              ) : (
                <div className="space-y-2">
                  <p className="font-medium">Delete conversation?</p>
                  <p className="wrap-break-word text-muted">
                    “{title}” will be removed from your history.
                  </p>
                </div>
              )}
              {error && (
                <p role="alert" className="text-destructive">
                  {error}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  className="h-10"
                  disabled={pending}
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant={mode === "delete" ? "destructive" : "default"}
                  className="h-10"
                  disabled={pending || (mode === "delete" && deletionBlocked)}
                >
                  {submitLabel}
                </Button>
              </div>
            </form>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
