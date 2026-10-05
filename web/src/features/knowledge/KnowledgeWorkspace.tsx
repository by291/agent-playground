import { useEffect, useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { UploadSimpleIcon } from "@phosphor-icons/react/dist/csr/UploadSimple";
import { Button } from "@/components/ui/button";
import {
  knowledgeFileUrl,
  maxKnowledgeBytes,
  type KnowledgeDocument,
} from "@shared/knowledge";
import { knowledgeRequest, listKnowledge } from "./api";
import { CircleNotchIcon } from "@phosphor-icons/react/dist/csr/CircleNotch";
import { AnimatePresence } from "motion/react";
import { AnimatedLi } from "@/components/ui/motion";

const queryKey = ["knowledge", "documents"];

export function KnowledgeWorkspace() {
  const client = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const pending = useRef<{ id: string; file: File } | null>(null);
  const resumeId = useRef<string | null>(null);
  const [operation, setOperation] = useState<{
    kind: "upload" | "reindex" | "delete";
    id: string;
  } | null>(null);
  const busy = operation !== null;
  const confirmation = useRef<HTMLDialogElement>(null);
  const confirmationId = useId();
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
      confirmation.current?.close();
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
            disabled={busy}
            onClick={() => {
              resumeId.current = null;
              input.current?.click();
            }}
          >
            {operation?.kind === "upload" ? (
              <CircleNotchIcon
                size={17}
                aria-hidden="true"
                className="motion-safe:animate-spin"
              />
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
          <p role="alert" className="mt-5 text-sm text-danger">
            {error}
          </p>
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
          <div role="alert" className="mt-5 text-sm text-danger">
            Could not load documents.{" "}
            <Button variant="ghost" onClick={() => void documents.refetch()}>
              Try again
            </Button>
          </div>
        )}
        <div className="mt-8 min-h-36 rounded-xl border border-line bg-surface">
          {documents.isPending && (
            <div role="status" className="min-h-36 p-6">
              <span className="sr-only">Loading documents…</span>
              <div
                aria-hidden="true"
                className="space-y-4 motion-safe:animate-pulse"
              >
                <div className="h-4 w-2/5 rounded bg-sidebar" />
                <div className="h-3 w-1/4 rounded bg-sidebar" />
                <div className="h-4 w-1/2 rounded bg-sidebar" />
              </div>
            </div>
          )}
          {documents.data?.length === 0 && (
            <p className="motion-content-enter min-h-36 p-8 text-sm text-muted">
              No documents yet. Upload a file to build your shared knowledge
              base.
            </p>
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
                    exit={{
                      opacity: 0,
                      height: 0,
                      padding: 0,
                      overflow: "hidden",
                    }}
                    className="flex flex-wrap items-center justify-between gap-4 p-5"
                  >
                    <div className="min-w-0 grow basis-56">
                      <p className="truncate text-sm font-medium">
                        {document.name}
                      </p>
                      <p className="mt-1 text-xs text-muted">
                        {Math.ceil(document.size / 1024)} KB ·{" "}
                        <span
                          key={status}
                          className="motion-content-enter inline-flex items-center gap-1.5 capitalize"
                          role="status"
                        >
                          {active && (
                            <CircleNotchIcon
                              size={12}
                              aria-hidden="true"
                              className="motion-safe:animate-spin"
                            />
                          )}
                          {status}
                        </span>
                      </p>
                      {document.error && (
                        <p className="mt-2 text-sm text-danger">
                          {document.error}
                        </p>
                      )}
                      {document.status === "uploading" && (
                        <p className="mt-2 text-xs text-muted">
                          Upload incomplete. Resume with the same file, or
                          delete this entry.
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {document.status !== "uploading" && (
                        <a
                          href={knowledgeFileUrl(document.id)}
                          download={document.name}
                          className="rounded p-2 text-xs text-muted hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
                        >
                          Download
                        </a>
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
                        onClick={() => {
                          setError(null);
                          setDeleting(document);
                          confirmation.current?.showModal();
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  </AnimatedLi>
                );
              })}
            </AnimatePresence>
          </ul>
        </div>
      </div>
      <dialog
        ref={confirmation}
        aria-labelledby={confirmationId}
        aria-describedby={`${confirmationId}-description`}
        onClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          const outside =
            event.clientX < bounds.left ||
            event.clientX > bounds.right ||
            event.clientY < bounds.top ||
            event.clientY > bounds.bottom;

          if (outside && !busy) {
            event.currentTarget.close();
          }
        }}
        onCancel={(event) => {
          if (busy) {
            event.preventDefault();
          }
        }}
        onClose={() => {
          setDeleting(null);
          setError(null);
        }}
        className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-line bg-surface p-6 text-ink shadow-xl backdrop:bg-black/25"
      >
        <h2 id={confirmationId} className="text-lg font-semibold">
          Delete document?
        </h2>
        <p
          id={`${confirmationId}-description`}
          className="mt-3 text-sm/6 text-muted"
        >
          “{deleting?.name}” will be removed from the shared knowledge base. New
          searches in all conversations will stop using it.
        </p>
        {deleting && error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button
            variant="outline"
            autoFocus
            disabled={busy}
            onClick={() => confirmation.current?.close()}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={() => void deleteDocument()}
          >
            {operation?.kind === "delete" && (
              <CircleNotchIcon
                aria-hidden="true"
                className="motion-safe:animate-spin"
              />
            )}
            {operation?.kind === "delete" ? "Deleting…" : "Delete document"}
          </Button>
        </div>
      </dialog>
    </main>
  );
}
