import {
  createContext,
  useContext,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { DotsThreeIcon } from "@phosphor-icons/react/dist/csr/DotsThree";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { conversationTitleSchema } from "@shared/conversation";
import { isRunActive, type RunStatus } from "@shared/run-status";
import type { ConversationHistory } from "../../hooks/useConversationHistory";

interface ConversationActionsProps {
  threadId: string;
  title: string;
  deletionBlocked: boolean;
  history: ConversationHistory;
}

interface ConversationActionTarget extends ConversationActionsProps {
  action: "rename" | "delete";
}

interface ConversationActionsState {
  pending: boolean;
  openAction: (
    action: ConversationActionTarget["action"],
    target: ConversationActionsProps,
  ) => void;
}

const ConversationActionsContext =
  createContext<ConversationActionsState | null>(null);

export function ConversationActionsProvider({
  children,
  history,
  current,
}: {
  children: ReactNode;
  history?: ConversationHistory | undefined;
  current?:
    { threadId: string; status: RunStatus | null; busy: boolean } | undefined;
}) {
  const id = useId();
  const [target, setTarget] = useState<ConversationActionTarget | null>(null);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const focusThreadId = useRef<string | null>(null);
  const action = target?.action ?? null;
  const activeHistory = history ?? target?.history;
  const entry = activeHistory?.conversations.find(
    (entry) => entry.threadId === target?.threadId,
  );
  const currentBlocked =
    current !== undefined &&
    current.threadId === target?.threadId &&
    (current.busy ||
      (current.status !== null && isRunActive(current.status)) ||
      current.status === "submission_unknown");
  const deletionBlocked =
    currentBlocked ||
    (entry
      ? (entry.status !== null && isRunActive(entry.status)) ||
        entry.status === "submission_unknown"
      : (target?.deletionBlocked ?? false));

  function openAction(
    next: "rename" | "delete",
    nextTarget: ConversationActionsProps,
  ) {
    if (pending || (next === "delete" && nextTarget.deletionBlocked)) {
      return;
    }

    focusThreadId.current = nextTarget.threadId;
    setDraft(nextTarget.title);
    setError(null);
    setTarget({ ...nextTarget, action: next });
  }

  function changeActionOpen(open: boolean) {
    if (pending || open) {
      return;
    }

    setTarget(null);
  }

  async function submit(next: "rename" | "delete") {
    if (
      !target ||
      !activeHistory ||
      pending ||
      (next === "delete" && deletionBlocked)
    ) {
      return;
    }

    const parsed = conversationTitleSchema.safeParse(draft);

    if (next === "rename" && !parsed.success) {
      setError("Enter a title between 1 and 100 characters.");

      return;
    }

    setPending(true);
    setError(null);

    try {
      if (next === "rename" && parsed.success) {
        await activeHistory.rename(target.threadId, parsed.data);
      } else if (next === "delete") {
        await activeHistory.remove(target.threadId);
      }

      setTarget(null);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Conversation update failed",
      );
    } finally {
      setPending(false);
    }
  }

  function restoreTriggerFocus(event: Event) {
    event.preventDefault();

    // Responsive navigation replaces row elements; restore the current trigger.
    const triggers = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        "[data-conversation-actions]",
      ),
    );
    const trigger = triggers.find(
      (element) =>
        element.dataset.conversationActions === focusThreadId.current &&
        element.isConnected &&
        !element.closest(
          '[hidden], [inert], [data-slot="sheet-content"][data-state="closed"]',
        ) &&
        getComputedStyle(element).display !== "none" &&
        getComputedStyle(element).visibility !== "hidden",
    );

    if (trigger) {
      trigger.focus();

      return;
    }

    const navigationTriggers = [
      document.getElementById("workspace-sidebar-trigger"),
      document.getElementById("workspace-navigation-trigger"),
    ];
    const navigationTrigger = navigationTriggers.find(
      (element) =>
        element?.isConnected &&
        getComputedStyle(element).display !== "none" &&
        getComputedStyle(element).visibility !== "hidden",
    );

    navigationTrigger?.focus();
  }

  return (
    <ConversationActionsContext.Provider value={{ pending, openAction }}>
      {children}
      <Dialog open={action === "rename"} onOpenChange={changeActionOpen}>
        <DialogContent
          showCloseButton={false}
          className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md origin-top-left transform-[translate(-50%,-50%)] rounded-xl border border-line bg-surface p-5 text-ink shadow-xl outline-none sm:p-6"
          aria-busy={pending}
          onCloseAutoFocus={restoreTriggerFocus}
          onEscapeKeyDown={(event) => {
            if (pending) {
              event.preventDefault();
            }
          }}
          onInteractOutside={(event) => {
            if (pending) {
              event.preventDefault();
            }
          }}
        >
          <DialogTitle className="text-lg font-semibold">
            Rename conversation
          </DialogTitle>
          <DialogDescription className="mt-1 text-sm text-muted">
            Update the title shown in your conversation history.
          </DialogDescription>
          <form
            className="mt-5 space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              void submit("rename");
            }}
          >
            <Field data-invalid={Boolean(error)}>
              <FieldLabel htmlFor={`${id}-title`}>
                Conversation title
              </FieldLabel>
              <Input
                id={`${id}-title`}
                value={draft}
                disabled={pending}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? `${id}-error` : undefined}
                onChange={(event) => setDraft(event.target.value)}
              />
              {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
            </Field>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => changeActionOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Spinner aria-hidden="true" />}
                {pending ? "Saving…" : "Save title"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog open={action === "delete"} onOpenChange={changeActionOpen}>
        <AlertDialogContent
          className="w-[calc(100%-2rem)] sm:max-w-md"
          aria-busy={pending}
          onCloseAutoFocus={restoreTriggerFocus}
          onEscapeKeyDown={(event) => {
            if (pending) {
              event.preventDefault();
            }
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Delete conversation?</AlertDialogTitle>
            <AlertDialogDescription className="wrap-break-word">
              “{target?.title}” will be removed from your history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deletionBlocked && (
            <p className="text-xs text-muted">
              Wait for the run to finish before deleting.
            </p>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending || deletionBlocked}
              onClick={(event) => {
                event.preventDefault();
                void submit("delete");
              }}
            >
              {pending && <Spinner aria-hidden="true" />}
              {pending ? "Deleting…" : "Delete conversation"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConversationActionsContext.Provider>
  );
}

export function ConversationActions(props: ConversationActionsProps) {
  const sharedActions = useContext(ConversationActionsContext);

  if (sharedActions) {
    return <ConversationActionsMenu {...props} />;
  }

  return (
    <ConversationActionsProvider
      history={props.history}
      current={{
        threadId: props.threadId,
        status: null,
        busy: props.deletionBlocked,
      }}
    >
      <ConversationActionsMenu {...props} />
    </ConversationActionsProvider>
  );
}

function ConversationActionsMenu(props: ConversationActionsProps) {
  const { threadId, title, deletionBlocked, history } = props;
  const actions = useContext(ConversationActionsContext);
  const [menuOpen, setMenuOpen] = useState(false);
  const openingDialog = useRef(false);

  if (!actions) {
    throw new Error("Conversation actions require a modal provider.");
  }

  const { pending, openAction: openSharedAction } = actions;

  function changeMenuOpen(next: boolean) {
    if (pending) {
      return;
    }

    setMenuOpen(next);

    if (next) {
      history.refresh();
    }
  }

  function openAction(next: "rename" | "delete") {
    openingDialog.current = true;
    openSharedAction(next, props);
  }

  return (
    <DropdownMenu open={menuOpen} onOpenChange={changeMenuOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="workspace-toolbar-button size-8 shrink-0"
          aria-label={`Actions for ${title}`}
          data-conversation-actions={threadId}
        >
          <DotsThreeIcon size={20} aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="right"
        align="start"
        sideOffset={6}
        collisionPadding={12}
        aria-label="Conversation actions"
        className="w-44"
        onCloseAutoFocus={(event) => {
          if (openingDialog.current) {
            event.preventDefault();
            openingDialog.current = false;
          }
        }}
      >
        <DropdownMenuItem onSelect={() => openAction("rename")}>
          <PencilSimpleIcon aria-hidden="true" />
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          disabled={deletionBlocked}
          onSelect={() => openAction("delete")}
        >
          <TrashIcon aria-hidden="true" />
          Delete
        </DropdownMenuItem>
        {deletionBlocked && (
          <p className="px-2 pt-1 text-xs text-muted">
            Wait for the run to finish before deleting.
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
