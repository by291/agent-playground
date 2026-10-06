import type { KnowledgeDocument } from "@shared/knowledge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";
import { AnimatedLi } from "@/components/ui/motion";
import { DocumentActions } from "./DocumentActions";
import type { KnowledgeOperation } from "./useKnowledgeDocuments";

interface DocumentRowProps {
  document: KnowledgeDocument;
  operation: KnowledgeOperation["kind"] | null;
  busy: boolean;
  onResume: () => void;
  onReindex: () => void;
  onEncoding: (opener: HTMLButtonElement | null) => void;
  onDelete: (opener: HTMLButtonElement | null) => void;
}

export function DocumentRow({
  document,
  operation,
  busy,
  ...actions
}: DocumentRowProps) {
  let status: string = document.status;

  if (operation === "delete") {
    status = "Deleting…";
  } else if (operation === "reindex") {
    status = "Queuing index…";
  }

  const active =
    operation !== null ||
    document.status === "queued" ||
    document.status === "indexing";

  return (
    <AnimatedLi
      layout="position"
      className="overflow-hidden"
      exit={{ opacity: 0, height: 0 }}
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
                document.status === "failed" ? "destructive" : "secondary"
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
              <AlertDescription>{document.error}</AlertDescription>
            </Alert>
          )}
          {document.status === "uploading" && (
            <p className="mt-2 text-xs text-muted">
              Upload incomplete. Resume with the same file, or delete this
              entry.
            </p>
          )}
        </ItemContent>
        <DocumentActions document={document} busy={busy} {...actions} />
      </Item>
    </AnimatedLi>
  );
}
