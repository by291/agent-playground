import { useRef, useState } from "react";
import { BrainIcon } from "@phosphor-icons/react/dist/csr/Brain";
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
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import type { Memory } from "@shared/memory";
import { CorrectMemoryDialog } from "./CorrectMemoryDialog";
import { MemoryRow } from "./MemoryRow";
import { useMemories } from "../hooks/useMemories";

export function MemoryWorkspace({
  onActionFocusFallback,
}: {
  onActionFocusFallback: () => void;
}) {
  const {
    query,
    memories,
    busy,
    inFlight,
    error,
    conflict,
    clearError,
    correct,
    forget,
  } = useMemories();
  const actionOpener = useRef<HTMLButtonElement | null>(null);
  const [correcting, setCorrecting] = useState<Memory | null>(null);
  const [forgetting, setForgetting] = useState<Memory | null>(null);

  const latestCorrection = memories.find(
    (memory) => memory.id === correcting?.id,
  );
  const latestForget = memories.find((memory) => memory.id === forgetting?.id);
  // The confirmation retains the revision the user reviewed even as data refreshes.
  const forgetChanged = Boolean(
    forgetting && latestForget && forgetting.revision !== latestForget.revision,
  );

  function restoreActionFocus(event: Event) {
    event.preventDefault();

    const opener = actionOpener.current;
    const canRestoreOpener = opener?.isConnected && !opener.closest("[inert]");

    // Forgetting removes its row, so the page supplies a stable focus fallback.
    if (canRestoreOpener) {
      opener.focus();
    } else {
      onActionFocusFallback();
    }

    actionOpener.current = null;
  }

  async function forgetSelectedMemory() {
    if (!forgetting) {
      return;
    }

    const succeeded = await forget(forgetting);

    if (succeeded) {
      setForgetting(null);
    }
  }

  return (
    <>
      <header className="mt-8">
        <div className="flex items-center gap-3">
          <BrainIcon
            size={24}
            className="shrink-0 text-muted"
            aria-hidden="true"
          />
          <h1 className="text-2xl font-semibold tracking-tight">Memory</h1>
        </div>
        <p className="mt-3 text-sm/6 text-muted">
          Preferences and project facts the agent remembers across
          conversations. Memories are shared by everyone using this workspace.
        </p>
        <p className="mt-1 text-sm/6 text-muted">
          Preferences apply across conversations. Project facts are used when
          you ask the agent to work on that project.
        </p>
        <p className="mt-1 text-sm/6 text-muted">
          Memory is enabled automatically in normal chat; this page lets you
          review and manage saved entries.
        </p>
      </header>
      {query.isError && !query.isFetchNextPageError && (
        <Alert variant="destructive" className="mt-5">
          <AlertDescription>Could not load memories.</AlertDescription>
          <Button
            variant="ghost"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            Try again
          </Button>
        </Alert>
      )}
      <Card className="mt-8 gap-0 border border-line bg-surface py-0 ring-0">
        {query.isPending && (
          <div role="status" className="min-h-36 p-6">
            <span className="sr-only">Loading memories…</span>
            <div aria-hidden="true" className="space-y-4">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/4" />
            </div>
          </div>
        )}
        {query.data && memories.length === 0 && (
          <Empty className="min-h-44 p-8">
            <EmptyHeader>
              <EmptyTitle>No memories yet</EmptyTitle>
              <EmptyDescription>
                Ask the agent to remember a preference or a project fact during
                a conversation.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        {memories.length > 0 && (
          <ul aria-label="Saved memories" className="divide-y divide-line">
            {memories.map((memory) => (
              <MemoryRow
                key={memory.id}
                memory={memory}
                busy={busy}
                onCorrect={(opener) => {
                  actionOpener.current = opener;
                  clearError();
                  setCorrecting(memory);
                }}
                onForget={(opener) => {
                  actionOpener.current = opener;
                  clearError();
                  setForgetting(memory);
                }}
              />
            ))}
          </ul>
        )}
      </Card>
      {query.isFetchNextPageError && (
        <Alert variant="destructive" className="mt-5">
          <AlertDescription>Could not load more memories.</AlertDescription>
          <Button
            variant="ghost"
            disabled={query.isFetching || busy}
            onClick={() => void query.fetchNextPage()}
          >
            Try loading more again
          </Button>
        </Alert>
      )}
      {query.hasNextPage && !query.isFetchNextPageError && (
        <div className="mt-5 flex justify-center">
          <Button
            variant="outline"
            disabled={query.isFetching || busy}
            onClick={() => void query.fetchNextPage()}
          >
            {query.isFetchingNextPage && (
              <Spinner aria-hidden="true" role="presentation" />
            )}
            {query.isFetchingNextPage ? "Loading more…" : "Load more"}
          </Button>
        </div>
      )}
      {correcting && (
        <CorrectMemoryDialog
          key={correcting.id}
          memory={correcting}
          latest={latestCorrection}
          busy={busy}
          refreshing={query.isFetching}
          conflict={conflict}
          error={error}
          clearError={clearError}
          inFlight={inFlight}
          onCloseAutoFocus={restoreActionFocus}
          onRefresh={() => void query.refetch()}
          onClose={() => {
            setCorrecting(null);
            clearError();
          }}
          onCorrect={correct}
        />
      )}
      <AlertDialog
        open={forgetting !== null}
        onOpenChange={(open) => {
          if (!open && !inFlight()) {
            setForgetting(null);
            clearError();
          }
        }}
      >
        <AlertDialogContent
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
          aria-busy={busy}
          onCloseAutoFocus={restoreActionFocus}
          onEscapeKeyDown={(event) => {
            if (inFlight()) {
              event.preventDefault();
            }
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Forget memory?</AlertDialogTitle>
            <AlertDialogDescription>
              This memory will stop being used in future replies across this
              workspace. Existing conversation messages will remain.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <p className="max-h-48 overflow-y-auto rounded-lg border border-line bg-canvas p-3 text-sm/6 whitespace-pre-wrap wrap-anywhere">
            {forgetting?.text}
          </p>
          {forgetting && error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {(forgetChanged || conflict) && !busy && (
            <div className="space-y-3">
              <p className="text-sm text-muted">
                This memory changed. Review the latest saved text before
                forgetting it.
              </p>
              {forgetChanged && latestForget ? (
                <>
                  <p className="text-sm/6 whitespace-pre-wrap wrap-anywhere">
                    {latestForget.text}
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setForgetting(latestForget);
                      clearError();
                    }}
                  >
                    Review latest memory
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-sm text-muted">
                    The latest version is unavailable. Refresh it to review the
                    saved text while keeping this confirmation open.
                  </p>
                  <Button
                    variant="outline"
                    disabled={query.isFetching}
                    onClick={() => void query.refetch()}
                  >
                    {query.isFetching && (
                      <Spinner aria-hidden="true" role="presentation" />
                    )}
                    Refresh latest memory
                  </Button>
                </>
              )}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy || forgetChanged || conflict}
              onClick={(event) => {
                // Keep the confirmation open for failures and revision conflicts.
                event.preventDefault();
                void forgetSelectedMemory();
              }}
            >
              {busy && <Spinner aria-hidden="true" role="presentation" />}
              {busy ? "Forgetting…" : "Forget memory"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
