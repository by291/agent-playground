import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  knowledgeFileUrl,
  maxKnowledgeBytes,
  type KnowledgeDocument,
} from "@shared/knowledge";
import { knowledgeRequest, listKnowledge } from "./api";
import { AnimatePresence } from "motion/react";
import { AnimatedLi } from "@/components/ui/motion";

const queryKey = ["knowledge", "documents"];

export function KnowledgeWorkspace() {
  const client = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const uploadButton = useRef<HTMLButtonElement>(null);
  const confirmationOpener = useRef<HTMLButtonElement | null>(null);
  const controller = useRef<AbortController | null>(null);
  const pending = useRef<{ id: string; file: File } | null>(null);
  const resumeId = useRef<string | null>(null);
  const [operation, setOperation] = useState<{
    kind: "upload" | "reindex" | "delete";
    id: string;
  } | null>(null);
  const busy = operation !== null;
  const [deleting, setDeleting] = useState<KnowledgeDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryUpload, setRetryUpload] = useState(false);
  const documents = useQuery({
    queryKey,
    queryFn: ({ signal }) => listKnowledge(signal),
    refetchInterval: (query) =>
      query.state.data?.some((document) =>
        ["uploading", "queued", "indexing"].includes(document.status),
      )
        ? 2000
        : false,
  });

  useEffect(() => () => controller.current?.abort(), []);

  async function perform(
    path: string,
    init: RequestInit,
    nextOperation: NonNullable<typeof operation>,
  ) {
    if (controller.current) {
      return;
    }

    const request = new AbortController();

    controller.current = request;
    setOperation(nextOperation);
    setError(null);

    try {
      await knowledgeRequest(path, { ...init, signal: request.signal });
      await client.invalidateQueries({ queryKey });

      return true;
    } catch (error) {
      if (request.signal.aborted) {
        return;
      }

      setError(
        error instanceof Error ? error.message : "Document request failed",
      );
      await client.invalidateQueries({ queryKey });

      return false;
    } finally {
      controller.current = null;

      if (!request.signal.aborted) {
        setOperation(null);
      }
    }
  }

  async function upload() {
    const document = pending.current;

    if (!document) {
      return;
    }

    const uploaded = await perform(
      "",
      {
        method: "POST",
        body: document.file,
        headers: {
          "X-Filename": encodeURIComponent(document.file.name),
          "X-Document-Id": document.id,
        },
      },
      { kind: "upload", id: document.id },
    );

    if (uploaded) {
      pending.current = null;
      setRetryUpload(false);
    } else if (uploaded === false) {
      setRetryUpload(true);
    }
  }

  async function deleteDocument() {
    if (!deleting) {
      return;
    }

    const removed = await perform(
      `/${deleting.id}`,
      { method: "DELETE" },
      { kind: "delete", id: deleting.id },
    );

    if (removed) {
      setDeleting(null);
    }
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
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];

              event.target.value = "";

              if (!file) {
                return;
              }

              if (
                !file.size ||
                file.size > maxKnowledgeBytes ||
                !/\.(txt|md|pdf)$/i.test(file.name)
              ) {
                setError(
                  "Use a nonempty TXT, Markdown or PDF file up to 10 MiB",
                );

                return;
              }

              pending.current = {
                id: resumeId.current ?? crypto.randomUUID(),
                file,
              };
              void upload();
            }}
          />
        </div>
        {error && !deleting && (
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
        <Card className="mt-8 min-h-36 gap-0 border border-line bg-surface py-0 ring-0">
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
              {documents.data?.map((document) => {
                const rowOperation =
                  operation?.id === document.id ? operation.kind : null;
                let status: string = document.status;

                if (rowOperation === "delete") {
                  status = "Deleting…";
                } else if (rowOperation === "reindex") {
                  status = "Queuing index…";
                }

                const active =
                  rowOperation !== null ||
                  document.status === "queued" ||
                  document.status === "indexing";

                return (
                  <AnimatedLi
                    key={document.id}
                    layout="position"
                    className="overflow-hidden"
                    exit={{
                      opacity: 0,
                      height: 0,
                    }}
                  >
                    <Item className="gap-4 rounded-none border-0 p-5">
                      <ItemContent className="min-w-0 grow basis-56">
                        <ItemTitle className="block w-full truncate">
                          {document.name}
                        </ItemTitle>
                        <div className="flex items-center gap-2">
                          <ItemDescription className="text-xs">
                            {Math.ceil(document.size / 1024)} KB
                          </ItemDescription>
                          <Badge
                            key={status}
                            variant={
                              document.status === "failed"
                                ? "destructive"
                                : "secondary"
                            }
                            className="motion-content-enter capitalize"
                            role="status"
                          >
                            {active && (
                              <Spinner
                                className="size-3"
                                aria-hidden="true"
                                role="presentation"
                              />
                            )}
                            {status}
                          </Badge>
                        </div>
                        {document.error && (
                          <Alert variant="destructive" className="mt-1">
                            <AlertDescription>
                              {document.error}
                            </AlertDescription>
                          </Alert>
                        )}
                        {document.status === "uploading" && (
                          <p className="mt-2 text-xs text-muted">
                            Upload incomplete. Resume with the same file, or
                            delete this entry.
                          </p>
                        )}
                      </ItemContent>
                      <ItemActions className="flex-wrap">
                        {document.status !== "uploading" && (
                          <Button asChild variant="ghost" size="sm">
                            <a
                              href={knowledgeFileUrl(document.id)}
                              download={document.name}
                            >
                              Download
                            </a>
                          </Button>
                        )}
                        {document.status === "uploading" && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={() => {
                              resumeId.current = document.id;
                              input.current?.click();
                            }}
                          >
                            Resume upload
                          </Button>
                        )}
                        {["ready", "failed"].includes(document.status) && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={() =>
                              void perform(
                                `/${document.id}/reindex`,
                                {
                                  method: "POST",
                                },
                                { kind: "reindex", id: document.id },
                              )
                            }
                          >
                            {document.status === "failed"
                              ? "Retry indexing"
                              : "Reindex"}
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          aria-label={`Delete ${document.name}`}
                          aria-haspopup="dialog"
                          onClick={(event) => {
                            confirmationOpener.current = event.currentTarget;
                            setError(null);
                            setDeleting(document);
                          }}
                        >
                          Delete
                        </Button>
                      </ItemActions>
                    </Item>
                  </AnimatedLi>
                );
              })}
            </AnimatePresence>
          </ul>
        </Card>
      </div>
      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (open || controller.current) {
            return;
          }

          setDeleting(null);
          setError(null);
        }}
      >
        <AlertDialogContent
          onEscapeKeyDown={(event) => {
            if (controller.current) {
              event.preventDefault();
            }
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();

            const opener = confirmationOpener.current;
            const canRestoreOpener =
              opener?.isConnected && !opener.closest("[inert]");

            if (canRestoreOpener) {
              opener.focus();
            } else {
              uploadButton.current?.focus();
            }

            confirmationOpener.current = null;
          }}
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
