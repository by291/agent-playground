import { GearSixIcon } from "@phosphor-icons/react/dist/csr/GearSix";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import {
  createContext,
  useContext,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Alert, AlertDescription } from "./ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./ui/alert-dialog";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/dialog";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "./ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Spinner } from "./ui/spinner";
import { Switch } from "./ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import {
  sendShortcutSchema,
  themePreferenceSchema,
  useUserPreferences,
} from "@/lib/preferences";

interface SettingsState {
  dialogId: string;
  open: boolean;
  openSettings: (trigger?: HTMLButtonElement) => void;
}

const SettingsContext = createContext<SettingsState | null>(null);

export function SettingsProvider({
  children,
  onClearConversations,
}: {
  children?: ReactNode;
  onClearConversations?: (() => Promise<void>) | undefined;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const openingTrigger = useRef<HTMLButtonElement | null>(null);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);
  const { preferences, updatePreferences, resetPreferences, saved } =
    useUserPreferences();

  function openSettings(trigger?: HTMLButtonElement) {
    openingTrigger.current = trigger ?? null;
    setClearError(null);
    setOpen(true);
  }

  function changeSettingsOpen(next: boolean) {
    if (clearing || confirmationOpen) {
      return;
    }

    setOpen(next);
  }

  function changeConfirmationOpen(next: boolean) {
    if (clearing) {
      return;
    }

    if (next) {
      setClearError(null);
    }

    setConfirmationOpen(next);
  }

  async function clearConversations() {
    if (!onClearConversations || clearing) {
      return;
    }

    setClearing(true);
    setClearError(null);

    try {
      await onClearConversations();
      setConfirmationOpen(false);
    } catch (error) {
      setClearError(
        error instanceof Error
          ? error.message
          : "Could not clear conversations. Try again.",
      );
    } finally {
      setClearing(false);
    }
  }

  const settings = { dialogId: `${id}-dialog`, open, openSettings };

  return (
    <SettingsContext.Provider value={settings}>
      <Dialog open={open} onOpenChange={changeSettingsOpen}>
        {children ?? <SettingsButton settings={settings} />}
        <DialogContent
          id={settings.dialogId}
          showCloseButton={false}
          className="fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg origin-top-left transform-[translate(-50%,-50%)] overflow-y-auto rounded-xl border border-line bg-surface p-5 text-ink shadow-xl outline-none sm:p-6"
          onEscapeKeyDown={(event) => {
            if (clearing || confirmationOpen) {
              event.preventDefault();
            }
          }}
          onInteractOutside={(event) => {
            if (clearing || confirmationOpen) {
              event.preventDefault();
            }
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();

            const opener = openingTrigger.current;
            const canRestoreOpener =
              opener?.isConnected &&
              !opener.closest(
                '[hidden], [inert], [data-slot="sheet-content"][data-state="closed"]',
              ) &&
              getComputedStyle(opener).display !== "none" &&
              getComputedStyle(opener).visibility !== "hidden";

            if (canRestoreOpener) {
              opener.focus();

              return;
            }

            const navigationTrigger = [
              "workspace-sidebar-trigger",
              "workspace-navigation-trigger",
            ]
              .map((id) => document.getElementById(id))
              .find(
                (element) =>
                  element?.isConnected &&
                  getComputedStyle(element).display !== "none" &&
                  getComputedStyle(element).visibility !== "hidden",
              );

            navigationTrigger?.focus();
          }}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <DialogTitle className="text-lg font-semibold">
                Settings
              </DialogTitle>
              <DialogDescription className="mt-1 text-sm text-muted">
                Personalize your workspace.
              </DialogDescription>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Close settings"
              className="workspace-toolbar-button size-8"
              disabled={clearing}
              onClick={() => changeSettingsOpen(false)}
            >
              <XIcon size={18} aria-hidden="true" />
            </Button>
          </div>
          <FieldGroup className="mt-6 gap-0 divide-y divide-line">
            <Field
              orientation="responsive"
              className="pb-5 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
            >
              <FieldContent>
                <FieldLabel htmlFor={`${id}-theme`}>Appearance</FieldLabel>
                <FieldDescription
                  id={`${id}-theme-description`}
                  className="text-xs/5"
                >
                  Choose your workspace colors.
                </FieldDescription>
              </FieldContent>
              <Select
                value={preferences.theme}
                onValueChange={(value) =>
                  updatePreferences({
                    theme: themePreferenceSchema.parse(value),
                  })
                }
              >
                <SelectTrigger
                  className="w-full shrink-0 border-line bg-surface sm:w-44 dark:bg-surface dark:hover:bg-sidebar"
                  id={`${id}-theme`}
                  aria-describedby={`${id}-theme-description`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" align="end">
                  <SelectGroup className="sm:gap-0.5">
                    <SelectItem value="light" className="sm:min-h-8 sm:py-1">
                      Light
                    </SelectItem>
                    <SelectItem value="dark" className="sm:min-h-8 sm:py-1">
                      Dark
                    </SelectItem>
                    <SelectItem value="system" className="sm:min-h-8 sm:py-1">
                      System
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field
              orientation="responsive"
              className="py-5 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
            >
              <FieldContent>
                <FieldLabel htmlFor={`${id}-shortcut`}>
                  Send shortcut
                </FieldLabel>
                <FieldDescription
                  id={`${id}-shortcut-description`}
                  className="text-xs/5"
                >
                  Shift + Enter always adds a new line.
                </FieldDescription>
              </FieldContent>
              <Select
                value={preferences.sendShortcut}
                onValueChange={(value) =>
                  updatePreferences({
                    sendShortcut: sendShortcutSchema.parse(value),
                  })
                }
              >
                <SelectTrigger
                  className="w-full shrink-0 border-line bg-surface sm:w-44 dark:bg-surface dark:hover:bg-sidebar"
                  id={`${id}-shortcut`}
                  aria-describedby={`${id}-shortcut-description`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" align="end">
                  <SelectGroup className="sm:gap-0.5">
                    <SelectItem value="enter" className="sm:min-h-8 sm:py-1">
                      Enter
                    </SelectItem>
                    <SelectItem
                      value="modifier-enter"
                      className="sm:min-h-8 sm:py-1"
                    >
                      Ctrl / Cmd + Enter
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field orientation="horizontal" className="items-center pt-5">
              <FieldContent>
                <FieldLabel htmlFor={`${id}-animation`}>
                  Reply animation
                </FieldLabel>
                <FieldDescription
                  id={`${id}-animation-description`}
                  className="text-xs/5"
                >
                  Reveal replies smoothly. Respects reduced motion.
                </FieldDescription>
              </FieldContent>
              <Switch
                id={`${id}-animation`}
                aria-describedby={`${id}-animation-description`}
                checked={preferences.replyAnimation}
                onCheckedChange={(replyAnimation) =>
                  updatePreferences({ replyAnimation })
                }
              />
            </Field>
          </FieldGroup>
          <p
            className="mt-6 text-xs text-muted"
            role={saved ? undefined : "status"}
          >
            {saved
              ? "Saved in this browser."
              : "Changes apply now but could not be saved in this browser."}
          </p>
          {onClearConversations && (
            <AlertDialog
              open={confirmationOpen}
              onOpenChange={changeConfirmationOpen}
            >
              <section
                aria-labelledby={`${id}-history-title`}
                className="mt-5 border-t border-line pt-5"
              >
                <Field
                  orientation="responsive"
                  className="sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                >
                  <FieldContent>
                    <FieldTitle id={`${id}-history-title`}>
                      Saved conversations
                    </FieldTitle>
                    <FieldDescription className="text-xs/5">
                      Remove every saved conversation from this shared
                      workspace.
                    </FieldDescription>
                  </FieldContent>
                  <AlertDialogTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full shrink-0 text-destructive sm:w-44"
                    >
                      Clear all conversations
                    </Button>
                  </AlertDialogTrigger>
                </Field>
              </section>
              <AlertDialogContent
                className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto sm:max-w-md"
                aria-busy={clearing}
                onEscapeKeyDown={(event) => {
                  if (clearing) {
                    event.preventDefault();
                  }
                }}
              >
                <AlertDialogHeader>
                  <AlertDialogTitle>Clear all conversations?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will remove every saved conversation from this shared
                    workspace. This cannot be undone in the app. Your
                    preferences will be kept.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <p className="text-xs/5 text-muted">
                  Running or unconfirmed conversations must finish first.
                </p>
                {clearError && (
                  <Alert variant="destructive">
                    <AlertDescription>{clearError}</AlertDescription>
                  </Alert>
                )}
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={clearing}>
                    Cancel
                  </AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    disabled={clearing}
                    onClick={(event) => {
                      // The request owns closing so errors remain available for retry.
                      event.preventDefault();
                      void clearConversations();
                    }}
                  >
                    {clearing && <Spinner aria-hidden="true" />}
                    {clearing ? "Clearing…" : "Delete all conversations"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          <div className="mt-5 flex items-center justify-end gap-3 border-t border-line pt-4">
            <Button
              type="button"
              variant="ghost"
              className="text-xs text-muted"
              onClick={resetPreferences}
            >
              Reset preferences
            </Button>
            <Button
              type="button"
              disabled={clearing}
              onClick={() => changeSettingsOpen(false)}
            >
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </SettingsContext.Provider>
  );
}

export function SettingsControl({
  onClearConversations,
}: {
  onClearConversations?: (() => Promise<void>) | undefined;
}) {
  const settings = useContext(SettingsContext);

  if (settings) {
    return <SettingsButton settings={settings} />;
  }

  return <SettingsProvider onClearConversations={onClearConversations} />;
}

function SettingsButton({ settings }: { settings: SettingsState }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="workspace-toolbar-button size-8 shrink-0"
          aria-label="Open settings"
          aria-haspopup="dialog"
          aria-expanded={settings.open}
          aria-controls={settings.dialogId}
          onClick={(event) => settings.openSettings(event.currentTarget)}
        >
          <GearSixIcon size={18} aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Settings</TooltipContent>
    </Tooltip>
  );
}
