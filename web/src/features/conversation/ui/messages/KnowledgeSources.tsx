import {
  knowledgeFileUrl,
  knowledgeSearchSchema,
  type KnowledgeSource,
} from "@shared/knowledge";
import type { toolProcess } from "../../model/turns";
import { useId, useRef, useState, type ReactNode } from "react";
import { BooksIcon } from "@phosphor-icons/react/dist/csr/Books";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { KnowledgeCitationProvider } from "./knowledgeCitations";

type RetrievedSource = KnowledgeSource & { number: number };

export function KnowledgeSources({
  process,
  children,
}: {
  process: ReturnType<typeof toolProcess>;
  children?: ReactNode;
}) {
  const documentControlId = useId();
  const [open, setOpen] = useState(false);
  const citationOpener = useRef<HTMLButtonElement | null>(null);
  const [selection, setSelection] = useState<{
    documentId: string;
    chunkId: string;
  } | null>(null);
  const sources = new Map<string, RetrievedSource>();
  const errors = new Set<string>();
  let searched = false;

  for (const step of process.flatMap((entry) => entry.calls)) {
    if (step.call.function.name !== "search_knowledge" || !step.result) {
      continue;
    }

    try {
      const result = knowledgeSearchSchema.safeParse(
        JSON.parse(step.result.content),
      );

      if (result.success) {
        searched = true;

        if (result.data.error) {
          errors.add(result.data.error);
        }

        for (const source of result.data.sources) {
          const number =
            sources.get(source.chunkId)?.number ?? sources.size + 1;

          sources.set(source.chunkId, { ...source, number });
        }
      }
    } catch {
      // Interrupted or legacy results may not carry a complete source contract.
    }
  }

  if (!searched) {
    return children;
  }

  const documents = new Map<string, RetrievedSource[]>();

  for (const source of sources.values()) {
    const passages = documents.get(source.documentId) ?? [];

    passages.push(source);
    documents.set(source.documentId, passages);
  }

  const passages =
    documents.get(selection?.documentId ?? "") ??
    [...documents.values()][0] ??
    [];
  const index = Math.max(
    0,
    passages.findIndex((source) => source.chunkId === selection?.chunkId),
  );
  const source = passages[index];
  let label = "Sources · No matches";

  if (documents.size) {
    label = `Sources · ${documents.size} ${documents.size === 1 ? "document" : "documents"}`;
  } else if (errors.size) {
    label = "Sources unavailable";
  }

  function selectPassage(next: number) {
    const passage = passages[next];

    if (passage) {
      setSelection({
        documentId: passage.documentId,
        chunkId: passage.chunkId,
      });
    }
  }

  function openCitation(chunkId: string, opener: HTMLButtonElement) {
    const selected = sources.get(chunkId);

    if (!selected) {
      return;
    }

    citationOpener.current = opener;
    setSelection({ documentId: selected.documentId, chunkId });
    setOpen(true);
  }

  return (
    <KnowledgeCitationProvider value={{ sources, onSelect: openCitation }}>
      <Dialog open={open} onOpenChange={setOpen}>
        {children}
        <div className="pt-1">
          <DialogTrigger asChild>
            <button
              type="button"
              onClick={() => {
                citationOpener.current = null;
              }}
              className="inline-flex min-h-10 items-center gap-2 rounded-full border border-line px-3 text-xs text-muted transition-colors hover:bg-sidebar hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
            >
              <BooksIcon size={16} aria-hidden="true" />
              {label}
            </button>
          </DialogTrigger>
        </div>
        <DialogContent
          className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-line bg-surface shadow-xl outline-none"
          onCloseAutoFocus={(event) => {
            if (citationOpener.current?.isConnected) {
              event.preventDefault();
              citationOpener.current.focus();
            }

            citationOpener.current = null;
          }}
        >
          <header className="flex shrink-0 items-start justify-between gap-4 border-b border-line p-5">
            <div>
              <DialogTitle className="text-base font-semibold">
                Sources
              </DialogTitle>
              <DialogDescription className="mt-1 text-xs text-muted">
                Passages retrieved for this reply.
              </DialogDescription>
            </div>
            <DialogClose asChild>
              <Button variant="ghost" size="icon" aria-label="Close sources">
                <XIcon size={18} aria-hidden="true" />
              </Button>
            </DialogClose>
          </header>
          {source && (
            <>
              <div className="space-y-4 border-b border-line p-5">
                <div>
                  <p
                    id={documentControlId}
                    className="mb-2 block text-xs font-medium text-muted"
                  >
                    Document
                  </p>
                  {documents.size === 1 ? (
                    <p className="text-sm/6 font-medium wrap-anywhere">
                      {source.name}
                    </p>
                  ) : (
                    <Select
                      value={source.documentId}
                      onValueChange={(id) => {
                        const first = documents.get(id)?.[0];

                        if (first) {
                          setSelection({
                            documentId: first.documentId,
                            chunkId: first.chunkId,
                          });
                        }
                      }}
                    >
                      <SelectTrigger
                        aria-labelledby={documentControlId}
                        title={source.name}
                        className="min-h-10 w-full gap-3 border-line bg-surface px-3 *:data-[slot=select-value]:min-w-0 *:data-[slot=select-value]:flex-1 dark:bg-surface dark:hover:bg-sidebar"
                      >
                        <SelectValue>
                          <span className="truncate">{source.name}</span>
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent
                        position="popper"
                        align="start"
                        sideOffset={4}
                        className="w-(--radix-select-trigger-width)"
                      >
                        <SelectGroup>
                          {[...documents].map(([id, entries]) => (
                            <SelectItem
                              key={id}
                              value={id}
                              title={entries[0]!.name}
                              className="*:last:min-w-0 *:last:flex-1"
                            >
                              <span className="line-clamp-2 wrap-anywhere">
                                {entries[0]!.name}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted">
                    Passage {index + 1} of {passages.length}
                  </span>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Previous passage"
                      disabled={index === 0}
                      onClick={() => selectPassage(index - 1)}
                    >
                      <ArrowLeftIcon size={16} aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Next passage"
                      disabled={index === passages.length - 1}
                      onClick={() => selectPassage(index + 1)}
                    >
                      <ArrowRightIcon size={16} aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              </div>
              <div
                key={source.chunkId}
                className="min-h-0 flex-1 overflow-y-auto p-5"
              >
                <p className="mb-3 text-xs font-medium text-accent">
                  Source [{source.number}]
                </p>
                {source.page !== null && (
                  <p className="mb-3 text-xs font-medium text-muted">
                    Page {source.page}
                  </p>
                )}
                <p className="text-base/7 whitespace-pre-wrap wrap-anywhere">
                  {source.excerpt}
                </p>
              </div>
              <footer className="shrink-0 border-t border-line p-5">
                <a
                  href={knowledgeFileUrl(source.documentId)}
                  download={source.name}
                  className="inline-flex min-h-10 items-center gap-2 rounded-lg px-2 text-sm text-accent hover:bg-sidebar focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <DownloadSimpleIcon size={16} aria-hidden="true" />
                  Download original
                </a>
              </footer>
            </>
          )}
          {!source && (
            <div className="p-5 text-sm text-muted">
              {errors.size
                ? [...errors].map((error) => (
                    <p key={error} className="mb-3 text-destructive">
                      {error}
                    </p>
                  ))
                : "No matching sources in the current index."}
            </div>
          )}
          {source && errors.size > 0 && (
            <p className="border-t border-line p-5 text-xs text-destructive">
              Some searches failed. These passages came from successful
              searches.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </KnowledgeCitationProvider>
  );
}
