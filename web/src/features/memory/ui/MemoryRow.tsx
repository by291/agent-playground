import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Memory } from "@shared/memory";

interface MemoryRowProps {
  memory: Memory;
  busy: boolean;
  onCorrect: (opener: HTMLButtonElement) => void;
  onForget: (opener: HTMLButtonElement) => void;
}

export function MemoryRow({
  memory,
  busy,
  onCorrect,
  onForget,
}: MemoryRowProps) {
  return (
    <li className="flex min-w-0 flex-col gap-4 p-5 sm:flex-row sm:items-start sm:p-6">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">
            {memory.category === "preference" ? "Preference" : "Project fact"}
          </Badge>
          {memory.project && (
            <span className="text-sm text-muted wrap-anywhere">
              {memory.project}
            </span>
          )}
        </div>
        <p className="mt-3 text-sm/6 whitespace-pre-wrap wrap-anywhere">
          {memory.text}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
          <span>
            Updated{" "}
            <time dateTime={memory.updatedAt}>
              {new Date(memory.updatedAt).toLocaleDateString()}
            </time>
          </span>
          {memory.sourceThreadId && memory.sourceThreadId.length <= 256 && (
            <a
              href={`/c/${encodeURIComponent(memory.sourceThreadId)}`}
              className="rounded underline underline-offset-4 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
            >
              Source conversation
            </a>
          )}
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button
          variant="outline"
          size="sm"
          className="max-md:h-11"
          disabled={busy}
          aria-label={`Correct memory: ${memory.text}`}
          onClick={(event) => onCorrect(event.currentTarget)}
        >
          <PencilSimpleIcon aria-hidden="true" />
          Correct
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted hover:text-destructive max-md:h-11"
          disabled={busy}
          aria-label={`Forget memory: ${memory.text}`}
          onClick={(event) => onForget(event.currentTarget)}
        >
          <TrashIcon aria-hidden="true" />
          Forget
        </Button>
      </div>
    </li>
  );
}
