import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { useId, useRef, useState, type ReactNode } from "react";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../ui/dialog";
import { useUserPreferences } from "@/shared/preferences/UserPreferencesProvider";
import { SettingsContext } from "./settings-context";
import { SettingsButton } from "./SettingsButton";
import { PreferencesForm } from "./PreferencesForm";
import { ClearConversationsDialog } from "./ClearConversationsDialog";

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
  const { resetPreferences } = useUserPreferences();

  // Keep the parent dialog mounted while its confirmation or request owns focus.
  const settingsCloseBlocked = clearing || confirmationOpen;

  function openSettings(trigger?: HTMLButtonElement) {
    openingTrigger.current = trigger ?? null;
    setClearError(null);
    setOpen(true);
  }

  function changeSettingsOpen(next: boolean) {
    if (settingsCloseBlocked) {
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

  function restoreSettingsFocus(event: Event) {
    event.preventDefault();

    // Responsive navigation can replace the opener while settings is displayed.
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
            if (settingsCloseBlocked) {
              event.preventDefault();
            }
          }}
          onInteractOutside={(event) => {
            if (settingsCloseBlocked) {
              event.preventDefault();
            }
          }}
          onCloseAutoFocus={restoreSettingsFocus}
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
          <PreferencesForm id={id} />
          {onClearConversations && (
            <ClearConversationsDialog
              id={id}
              confirmationOpen={confirmationOpen}
              changeConfirmationOpen={changeConfirmationOpen}
              clearing={clearing}
              clearError={clearError}
              clearConversations={clearConversations}
            />
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
