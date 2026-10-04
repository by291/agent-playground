import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { UploadSimpleIcon } from "@phosphor-icons/react/dist/csr/UploadSimple";
import { Button } from "@/components/ui/button";
import { knowledgeFileUrl, maxKnowledgeBytes } from "@shared/knowledge";
import { knowledgeRequest, listKnowledge } from "./api";

const queryKey = ["knowledge", "documents"];

export function KnowledgeWorkspace() {
  const client = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const pending = useRef<{ id: string; file: File } | null>(null);
  const resumeId = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
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

  async function perform(path: string, init: RequestInit) {
    if (controller.current) {
      return;
    }

    const request = new AbortController();

    controller.current = request;
    setBusy(true);
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
        setBusy(false);
      }
    }
  }

  async function upload() {
    const document = pending.current;

    if (!document) {
      return;
    }

    const uploaded = await perform("", {
      method: "POST",
      body: document.file,
      headers: {
        "X-Filename": encodeURIComponent(document.file.name),
        "X-Document-Id": document.id,
      },
    });

    if (uploaded) {
      pending.current = null;
      setRetryUpload(false);
    } else if (uploaded === false) {
      setRetryUpload(true);
    }
  }

  return (
    <main className="min-h-dvh bg-canvas px-4 py-8 text-ink sm:px-8">
      <div className="mx-auto max-w-4xl">
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
            <UploadSimpleIcon size={17} aria-hidden="true" />{" "}
            {busy ? "Working…" : "Upload document"}
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
        {error && (
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
        <div className="mt-8 rounded-xl border border-line bg-surface">
          {documents.isPending && (
            <p className="p-6 text-sm text-muted">Loading documents…</p>
          )}
          {documents.data?.length === 0 && (
            <p className="p-8 text-sm text-muted">
              No documents yet. Upload a file to build your shared knowledge
              base.
            </p>
          )}
          <ul className="divide-y divide-line">
            {documents.data?.map((document) => (
              <li
                key={document.id}
                className="flex flex-wrap items-center justify-between gap-4 p-5"
              >
                <div className="min-w-0 grow basis-56">
                  <p className="truncate text-sm font-medium">
                    {document.name}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {Math.ceil(document.size / 1024)} KB ·{" "}
                    <span className="capitalize">{document.status}</span>
                  </p>
                  {document.error && (
                    <p className="mt-2 text-sm text-danger">{document.error}</p>
                  )}
                  {document.status === "uploading" && (
                    <p className="mt-2 text-xs text-muted">
                      Upload incomplete. Resume with the same file, or delete
                      this entry.
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
                        void perform(`/${document.id}/reindex`, {
                          method: "POST",
                        })
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
                    onClick={() =>
                      void perform(`/${document.id}`, { method: "DELETE" })
                    }
                  >
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </main>
  );
}
