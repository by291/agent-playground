import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { memoryEditSchema, type Memory } from "@shared/memory";

interface CorrectMemoryDialogProps {
  memory: Memory;
  latest: Memory | undefined;
  busy: boolean;
  refreshing: boolean;
  conflict: boolean;
  error: string | null;
  clearError: () => void;
  inFlight: () => boolean;
  onClose: () => void;
  onRefresh: () => void;
  onCloseAutoFocus: (event: Event) => void;
  onCorrect: (memory: Memory, text: string) => Promise<boolean | undefined>;
}

export function CorrectMemoryDialog({
  memory,
  latest,
  busy,
  refreshing,
  conflict,
  error,
  clearError,
  inFlight,
  onClose,
  onRefresh,
  onCloseAutoFocus,
  onCorrect,
}: CorrectMemoryDialogProps) {
  const [version, setVersion] = useState(memory);
  const [text, setText] = useState(memory.text);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Keep edits tied to the reviewed revision until the user adopts a newer one.
  const newerVersion = latest && latest.revision !== version.revision;
  const needsReview = Boolean(newerVersion) || conflict;

  async function correct() {
    const parsed = memoryEditSchema.safeParse({
      category: version.category,
      project: version.project,
      revision: version.revision,
      text,
    });

    if (!parsed.success) {
      setValidationError("Enter memory text between 1 and 1,000 characters.");

      return;
    }

    setValidationError(null);

    const succeeded = await onCorrect(version, parsed.data.text);

    if (succeeded) {
      onClose();
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !inFlight()) {
          onClose();
        }
      }}
    >
      <DialogContent
        className="fixed top-1/2 left-1/2 z-50 grid max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg origin-top-left transform-[translate(-50%,-50%)] gap-5 overflow-y-auto rounded-xl border border-line bg-surface p-5 text-ink shadow-xl outline-none sm:p-6"
        aria-busy={busy}
        onCloseAutoFocus={onCloseAutoFocus}
        onEscapeKeyDown={(event) => {
          if (inFlight()) {
            event.preventDefault();
          }
        }}
        onInteractOutside={(event) => {
          if (inFlight()) {
            event.preventDefault();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">
            Correct memory
          </DialogTitle>
          <DialogDescription className="text-sm text-muted">
            Update what the agent remembers across conversations in this
            workspace.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();

            if (!busy && !needsReview) {
              void correct();
            }
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="memory-text">Memory text</Label>
            <Textarea
              id="memory-text"
              value={text}
              rows={5}
              maxLength={1000}
              disabled={busy}
              aria-invalid={Boolean(validationError)}
              aria-describedby={
                validationError ? "memory-text-error" : "memory-text-help"
              }
              className="max-h-64 min-h-36 resize-y field-sizing-fixed"
              onChange={(event) => {
                setText(event.target.value);
                setValidationError(null);
              }}
            />
            <p id="memory-text-help" className="text-xs text-muted">
              {text.length.toLocaleString()} / 1,000 characters
            </p>
            {validationError && (
              <p
                id="memory-text-error"
                role="alert"
                className="text-sm text-destructive"
              >
                {validationError}
              </p>
            )}
          </div>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {needsReview && !busy && (
            <div className="space-y-3 rounded-lg border border-line bg-canvas p-4">
              <p className="text-sm text-muted">
                This memory changed. Review the latest saved text before
                replacing it.
              </p>
              {latest && newerVersion ? (
                <>
                  <p className="text-sm/6 whitespace-pre-wrap wrap-anywhere">
                    {latest.text}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      setVersion(latest);
                      clearError();
                    }}
                  >
                    Keep my correction
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-sm text-muted">
                    The latest version is unavailable. Refresh it to review the
                    saved text while keeping your correction.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={refreshing}
                    onClick={onRefresh}
                  >
                    {refreshing && (
                      <Spinner aria-hidden="true" role="presentation" />
                    )}
                    Refresh latest memory
                  </Button>
                </>
              )}
            </div>
          )}
          <DialogFooter className="flex-col-reverse sm:flex-row">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={busy || needsReview || text.trim().length === 0}
            >
              {busy && <Spinner aria-hidden="true" role="presentation" />}
              {busy ? "Saving…" : "Save correction"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
