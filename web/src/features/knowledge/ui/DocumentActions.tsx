import { useRef } from "react";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowClockwise";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { DotsThreeIcon } from "@phosphor-icons/react/dist/csr/DotsThree";
import { TranslateIcon } from "@phosphor-icons/react/dist/csr/Translate";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ItemActions } from "@/components/ui/item";
import { knowledgeFileUrl, type KnowledgeDocument } from "@shared/knowledge";

interface DocumentActionsProps {
  document: KnowledgeDocument;
  busy: boolean;
  onResume: () => void;
  onReindex: () => void;
  onEncoding: (opener: HTMLButtonElement | null) => void;
  onDelete: (opener: HTMLButtonElement | null) => void;
}

export function DocumentActions({
  document,
  busy,
  onResume,
  onReindex,
  onEncoding,
  onDelete,
}: DocumentActionsProps) {
  const trigger = useRef<HTMLButtonElement>(null);
  const openingDialog = useRef(false);
  const canReindex = ["ready", "failed"].includes(document.status);
  const canChooseEncoding = canReindex && /\.(txt|md)$/i.test(document.name);

  return (
    <ItemActions className="ml-auto shrink-0">
      {document.status === "uploading" ? (
        <Button
          variant="outline"
          size="sm"
          className="max-md:h-11"
          disabled={busy}
          onClick={onResume}
        >
          Resume upload
        </Button>
      ) : (
        <Button asChild variant="outline" size="sm" className="max-md:h-11">
          <a href={knowledgeFileUrl(document.id)} download={document.name}>
            <DownloadSimpleIcon aria-hidden="true" />
            Download
          </a>
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            ref={trigger}
            variant="outline"
            size="icon-sm"
            className="max-md:size-11"
            disabled={busy}
            aria-label={`Actions for ${document.name}`}
          >
            <DotsThreeIcon aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          collisionPadding={12}
          className="w-48"
          aria-label={`Actions for ${document.name}`}
          onCloseAutoFocus={(event) => {
            // A dialog takes focus when selected from the closing menu.
            if (openingDialog.current) {
              event.preventDefault();
              openingDialog.current = false;
            }
          }}
        >
          {canReindex && (
            <DropdownMenuItem onSelect={onReindex}>
              <ArrowClockwiseIcon aria-hidden="true" />
              {document.status === "failed" ? "Retry indexing" : "Reindex"}
            </DropdownMenuItem>
          )}
          {canChooseEncoding && (
            <DropdownMenuItem
              onSelect={() => {
                openingDialog.current = true;
                onEncoding(trigger.current);
              }}
            >
              <TranslateIcon aria-hidden="true" />
              Text encoding
            </DropdownMenuItem>
          )}
          {canReindex && <DropdownMenuSeparator />}
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => {
              openingDialog.current = true;
              onDelete(trigger.current);
            }}
          >
            <TrashIcon aria-hidden="true" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </ItemActions>
  );
}
