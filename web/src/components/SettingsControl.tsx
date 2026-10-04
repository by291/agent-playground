import { GearSixIcon, XIcon } from "@phosphor-icons/react";
import {
  createContext,
  useContext,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button } from "./ui/button";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";
import {
  sendShortcutSchema,
  themePreferenceSchema,
  useUserPreferences,
} from "@/lib/preferences";

interface SettingsState {
  dialogId: string;
  open: boolean;
  openSettings: () => void;
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
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const confirmation = useRef<HTMLDialogElement>(null);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);
  const { preferences, updatePreferences, resetPreferences, saved } =
    useUserPreferences();

  function openSettings() {
    setClearError(null);
    dialog.current?.showModal();
    setOpen(true);
  }

  function closeSettings() {
    if (clearing || confirmation.current?.open) {
      return;
    }

    dialog.current?.close();
  }

  function openConfirmation() {
    setClearError(null);
    confirmation.current?.showModal();
  }

  function closeConfirmation() {
    if (clearing) {
      return;
    }

    confirmation.current?.close();
  }

  async function clearConversations() {
    if (!onClearConversations || clearing) {
      return;
    }

    setClearing(true);
    setClearError(null);

    try {
      await onClearConversations();
      confirmation.current?.close();
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
      {children ?? <SettingsButton settings={settings} />}
      <dialog
        ref={dialog}
        id={`${id}-dialog`}
        aria-labelledby={`${id}-title`}
        onClose={(event) => {
          event.stopPropagation();
          setOpen(false);
        }}
        onCancel={(event) => {
          event.stopPropagation();

          if (clearing || confirmation.current?.open) {
            event.preventDefault();
          }
        }}
        onClick={(event) => {
          if (event.target !== event.currentTarget) {
            return;
          }

          const bounds = event.currentTarget.getBoundingClientRect();
          const outside =
            event.clientX < bounds.left ||
            event.clientX > bounds.right ||
            event.clientY < bounds.top ||
            event.clientY > bounds.bottom;

          if (outside) {
            closeSettings();
          }
        }}
        className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-xl border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-black/40"
      >
        <div className="p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id={`${id}-title`} className="text-lg font-semibold">
                Settings
              </h2>
              <p className="mt-1 text-sm text-muted">
                Personalize your workspace.
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Close settings"
              className="workspace-toolbar-button size-8"
              disabled={clearing}
              onClick={closeSettings}
            >
              <XIcon size={18} aria-hidden="true" />
            </Button>
          </div>
          <div className="mt-6 divide-y divide-line">
            <div className="flex flex-col gap-3 pb-5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <div className="min-w-0 flex-1">
                <label htmlFor={`${id}-theme`} className="text-sm font-medium">
                  Appearance
                </label>
                <p
                  id={`${id}-theme-description`}
                  className="mt-1 text-xs/5 text-muted"
                >
                  Choose your workspace colors.
                </p>
              </div>
              <NativeSelect
                className="w-full shrink-0 sm:w-44"
                id={`${id}-theme`}
                aria-describedby={`${id}-theme-description`}
                value={preferences.theme}
                onChange={(event) =>
                  updatePreferences({
                    theme: themePreferenceSchema.parse(event.target.value),
                  })
                }
              >
                <NativeSelectOption value="light">Light</NativeSelectOption>
                <NativeSelectOption value="dark">Dark</NativeSelectOption>
                <NativeSelectOption value="system">System</NativeSelectOption>
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <div className="min-w-0 flex-1">
                <label
                  htmlFor={`${id}-shortcut`}
                  className="text-sm font-medium"
                >
                  Send shortcut
                </label>
                <p
                  id={`${id}-shortcut-description`}
                  className="mt-1 text-xs/5 text-muted"
                >
                  Shift + Enter always adds a new line.
                </p>
              </div>
              <NativeSelect
                className="w-full shrink-0 sm:w-44"
                id={`${id}-shortcut`}
                aria-describedby={`${id}-shortcut-description`}
                value={preferences.sendShortcut}
                onChange={(event) =>
                  updatePreferences({
                    sendShortcut: sendShortcutSchema.parse(event.target.value),
                  })
                }
              >
                <NativeSelectOption value="enter">Enter</NativeSelectOption>
                <NativeSelectOption value="modifier-enter">
                  Ctrl / Cmd + Enter
                </NativeSelectOption>
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-3 pt-5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <div className="min-w-0 flex-1">
                <label
                  htmlFor={`${id}-animation`}
                  className="text-sm font-medium"
                >
                  Reply animation
                </label>
                <p
                  id={`${id}-animation-description`}
                  className="mt-1 text-xs/5 text-muted"
                >
                  Reveal replies smoothly. Respects reduced motion.
                </p>
              </div>
              <NativeSelect
                className="w-full shrink-0 sm:w-44"
                id={`${id}-animation`}
                aria-describedby={`${id}-animation-description`}
                value={preferences.replyAnimation ? "on" : "off"}
                onChange={(event) =>
                  updatePreferences({
                    replyAnimation: event.target.value === "on",
                  })
                }
              >
                <NativeSelectOption value="on">On</NativeSelectOption>
                <NativeSelectOption value="off">Off</NativeSelectOption>
              </NativeSelect>
            </div>
          </div>
          <p
            className="mt-6 text-xs text-muted"
            role={saved ? undefined : "status"}
          >
            {saved
              ? "Saved in this browser."
              : "Changes apply now but could not be saved in this browser."}
          </p>
          {onClearConversations && (
            <section
              aria-labelledby={`${id}-history-title`}
              className="mt-5 border-t border-line pt-5"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <div className="min-w-0 flex-1">
                  <h3
                    id={`${id}-history-title`}
                    className="text-sm font-medium"
                  >
                    Saved conversations
                  </h3>
                  <p className="mt-1 text-xs/5 text-muted">
                    Remove every saved conversation from this shared workspace.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full shrink-0 text-destructive sm:w-44"
                  onClick={openConfirmation}
                  aria-haspopup="dialog"
                  aria-controls={`${id}-confirmation`}
                >
                  Clear all conversations
                </Button>
              </div>
            </section>
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
            <Button type="button" disabled={clearing} onClick={closeSettings}>
              Done
            </Button>
          </div>
        </div>
      </dialog>
      <dialog
        ref={confirmation}
        id={`${id}-confirmation`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${id}-confirmation-title`}
        aria-describedby={`${id}-confirmation-description`}
        onClose={(event) => event.stopPropagation()}
        onCancel={(event) => {
          event.stopPropagation();

          if (clearing) {
            event.preventDefault();
          }
        }}
        onClick={(event) => {
          if (event.target !== event.currentTarget) {
            return;
          }

          const bounds = event.currentTarget.getBoundingClientRect();
          const outside =
            event.clientX < bounds.left ||
            event.clientX > bounds.right ||
            event.clientY < bounds.top ||
            event.clientY > bounds.bottom;

          if (outside) {
            closeConfirmation();
          }
        }}
        className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-xl border border-line bg-surface p-5 text-ink shadow-xl backdrop:bg-black/25 sm:p-6"
      >
        <h2 id={`${id}-confirmation-title`} className="text-lg font-semibold">
          Clear all conversations?
        </h2>
        <p
          id={`${id}-confirmation-description`}
          className="mt-3 text-sm/6 text-muted"
        >
          This will remove every saved conversation from this shared workspace.
          This cannot be undone in the app. Your preferences will be kept.
        </p>
        <p className="mt-2 text-xs/5 text-muted">
          Running or unconfirmed conversations must finish first.
        </p>
        {clearError && (
          <p role="alert" className="mt-3 text-sm/6 text-destructive">
            {clearError}
          </p>
        )}
        <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-line pt-4">
          <Button
            type="button"
            variant="outline"
            autoFocus
            disabled={clearing}
            onClick={closeConfirmation}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={clearing}
            onClick={() => void clearConversations()}
          >
            {clearing ? "Clearing…" : "Delete all conversations"}
          </Button>
        </div>
      </dialog>
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
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="workspace-toolbar-button size-8 shrink-0"
      aria-label="Open settings"
      title="Settings"
      aria-haspopup="dialog"
      aria-expanded={settings.open}
      aria-controls={settings.dialogId}
      onClick={settings.openSettings}
    >
      <GearSixIcon size={18} aria-hidden="true" />
    </Button>
  );
}
