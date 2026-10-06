import { useState } from "react";
import {
  knowledgeTextEncodings,
  knowledgeTextEncodingSchema,
  type KnowledgeDocument,
  type KnowledgeTextEncoding,
} from "@shared/knowledge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";

interface TextEncodingDialogProps {
  document: KnowledgeDocument;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
  onReindex: (
    encoding: KnowledgeTextEncoding | null,
  ) => Promise<boolean | undefined>;
}

export function TextEncodingDialog({
  document,
  busy,
  error,
  onClose,
  onCloseAutoFocus,
  onReindex,
}: TextEncodingDialogProps) {
  const [encoding, setEncoding] = useState<KnowledgeTextEncoding | "auto">(
    document.textEncoding ?? "auto",
  );

  async function reindex() {
    const succeeded = await onReindex(encoding === "auto" ? null : encoding);

    if (succeeded) {
      onClose();
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) {
          onClose();
        }
      }}
    >
      <DialogContent
        className="fixed top-1/2 left-1/2 z-50 grid w-[calc(100%-2rem)] max-w-md origin-top-left transform-[translate(-50%,-50%)] gap-5 rounded-xl border border-line bg-surface p-5 text-ink shadow-xl outline-none sm:p-6"
        aria-busy={busy}
        onCloseAutoFocus={onCloseAutoFocus}
        onEscapeKeyDown={(event) => {
          if (busy) {
            event.preventDefault();
          }
        }}
        onInteractOutside={(event) => {
          if (busy) {
            event.preventDefault();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">
            Text encoding
          </DialogTitle>
          <DialogDescription className="text-sm text-muted">
            Choose how to read “{document.name}”. Reindexing replaces its
            searchable text.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="knowledge-text-encoding">Text encoding</Label>
          <Select
            value={encoding}
            disabled={busy}
            onValueChange={(value) =>
              setEncoding(
                value === "auto"
                  ? "auto"
                  : knowledgeTextEncodingSchema.parse(value),
              )
            }
          >
            <SelectTrigger id="knowledge-text-encoding" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Automatic detection</SelectItem>
              {knowledgeTextEncodings.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <DialogFooter className="flex-col-reverse sm:flex-row">
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={() => void reindex()}>
            {busy && <Spinner aria-hidden="true" role="presentation" />}
            {busy ? "Queuing index…" : "Reindex document"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
