import { useRef, useState } from "react";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { UploadSimpleIcon } from "@phosphor-icons/react/dist/csr/UploadSimple";
import { Button } from "@/components/ui/button";
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
import { Card } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import type { KnowledgeDocument } from "@shared/knowledge";
import { TextEncodingDialog } from "./TextEncodingDialog";
import { DocumentRow } from "./DocumentRow";
import { useKnowledgeDocuments } from "./useKnowledgeDocuments";
import { AnimatePresence } from "motion/react";

export function KnowledgeWorkspace() {
  const {
    documents,
    operation,
    busy,
    inFlight,
    error,
    clearError,
    retryUpload,
    selectFile,
    upload,
    reindex,
    remove,
  } = useKnowledgeDocuments();
  const input = useRef<HTMLInputElement>(null);
  const uploadButton = useRef<HTMLButtonElement>(null);
  const actionOpener = useRef<HTMLButtonElement | null>(null);
  const resumeId = useRef<string | null>(null);
  const [deleting, setDeleting] = useState<KnowledgeDocument | null>(null);
  const [encodingDocument, setEncodingDocument] =
    useState<KnowledgeDocument | null>(null);

  async function deleteDocument() {
    if (!deleting) {
      return;
    }

    const removed = await remove(deleting.id);

    if (removed) {
      setDeleting(null);
    }
  }

  function restoreActionFocus(event: Event) {
    event.preventDefault();

    const opener = actionOpener.current;
    const canRestoreOpener = opener?.isConnected && !opener.closest("[inert]");

    if (canRestoreOpener) {
      opener.focus();
    } else {
      uploadButton.current?.focus();
    }

    actionOpener.current = null;
  }

  return (
    <main className="min-h-dvh bg-canvas px-4 py-8 text-ink sm:px-8">
      <div className="motion-content-enter mx-auto max-w-4xl">
        <a
          href="/"
          className="inline-flex items-center gap-2 rounded text-sm text-muted hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
        >
          <ArrowLeftIcon size={16} aria-hidden="true" /> Back to chat
        </a>
        <div className="mt-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Knowledge</h1>
            <p className="mt-2 text-sm text-muted">
              Upload documents for all conversations to search.
            </p>
            <p className="mt-1 text-xs text-muted">
              TXT, Markdown and text PDFs · Up to 10 MiB per file
            </p>
          </div>
          <Button
            ref={uploadButton}
            disabled={busy}
            onClick={() => {
              resumeId.current = null;
              input.current?.click();
            }}
          >
            {operation?.kind === "upload" ? (
              <Spinner aria-hidden="true" role="presentation" />
            ) : (
              <UploadSimpleIcon size={17} aria-hidden="true" />
            )}
            {operation?.kind === "upload" ? "Uploading…" : "Upload document"}
          </Button>
          <input
            ref={input}
            type="file"
            accept=".txt,.md,.pdf"
            aria-label="Document file"
            disabled={busy}
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];

              event.target.value = "";

              if (!file) {
                return;
              }

              selectFile(file, resumeId.current);
            }}
          />
        </div>
        {error && !deleting && !encodingDocument && (
          <Alert variant="destructive" className="mt-5">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {retryUpload && (
          <Button
            variant="outline"
            className="mt-3"
            disabled={busy}
            onClick={() => void upload()}
          >
            Retry upload
          </Button>
        )}
        {documents.isError && (
          <Alert variant="destructive" className="mt-5">
            <AlertDescription>Could not load documents.</AlertDescription>
            <Button variant="ghost" onClick={() => void documents.refetch()}>
              Try again
            </Button>
          </Alert>
        )}
        <Card className="mt-8 gap-0 border border-line bg-surface py-0 ring-0">
          {documents.isPending && (
            <div role="status" className="min-h-36 p-6">
              <span className="sr-only">Loading documents…</span>
              <div aria-hidden="true" className="space-y-4">
                <Skeleton className="h-4 w-2/5" />
                <Skeleton className="h-3 w-1/4" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            </div>
          )}
          {documents.data?.length === 0 && (
            <Empty className="motion-content-enter min-h-36 p-8">
              <EmptyHeader>
                <EmptyTitle>No documents yet</EmptyTitle>
                <EmptyDescription>
                  Upload a file to build your shared knowledge base.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          <ul className="relative divide-y divide-line">
            <AnimatePresence initial={false}>
              {documents.data?.map((document) => (
                <DocumentRow
                  key={document.id}
                  document={document}
                  operation={
                    operation?.id === document.id ? operation.kind : null
                  }
                  busy={busy}
                  onResume={() => {
                    resumeId.current = document.id;
                    input.current?.click();
                  }}
                  onReindex={() => void reindex(document.id)}
                  onEncoding={(opener) => {
                    actionOpener.current = opener;
                    clearError();
                    setEncodingDocument(document);
                  }}
                  onDelete={(opener) => {
                    actionOpener.current = opener;
                    clearError();
                    setDeleting(document);
                  }}
                />
              ))}
            </AnimatePresence>
          </ul>
        </Card>
      </div>
      {encodingDocument && (
        <TextEncodingDialog
          key={encodingDocument.id}
          document={encodingDocument}
          busy={busy}
          error={error}
          onCloseAutoFocus={restoreActionFocus}
          onClose={() => {
            setEncodingDocument(null);
            clearError();
          }}
          onReindex={(textEncoding) =>
            reindex(encodingDocument.id, textEncoding)
          }
        />
      )}
      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (open || inFlight()) {
            return;
          }

          setDeleting(null);
          clearError();
        }}
      >
        <AlertDialogContent
          onEscapeKeyDown={(event) => {
            if (inFlight()) {
              event.preventDefault();
            }
          }}
          onCloseAutoFocus={restoreActionFocus}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Delete document?</AlertDialogTitle>
            <AlertDialogDescription>
              “{deleting?.name}” will be removed from the shared knowledge base.
              New searches in all conversations will stop using it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleting && error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={(event) => {
                // Deletion keeps the confirmation open until the request succeeds.
                event.preventDefault();
                void deleteDocument();
              }}
            >
              {operation?.kind === "delete" && (
                <Spinner aria-hidden="true" role="presentation" />
              )}
              {operation?.kind === "delete" ? "Deleting…" : "Delete document"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
