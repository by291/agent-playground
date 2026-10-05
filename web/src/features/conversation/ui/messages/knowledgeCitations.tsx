import { createContext, useContext } from "react";
import type { ExtraProps } from "streamdown";
import type { KnowledgeSource } from "@shared/knowledge";

export type KnowledgeCitationSource = Pick<
  KnowledgeSource,
  "chunkId" | "name" | "page"
> & { number: number };

const citationContext = createContext<{
  sources: ReadonlyMap<string, KnowledgeCitationSource>;
  onSelect: (chunkId: string, opener: HTMLButtonElement) => void;
} | null>(null);

export const KnowledgeCitationProvider = citationContext.Provider;

export function KnowledgeCitation({ chunkId }: { chunkId: string }) {
  const context = useContext(citationContext);
  const source = context?.sources.get(chunkId);

  if (!source || !context) {
    return (
      <sup className="mx-0.5 text-xs text-muted" title="Source unavailable">
        [?]
      </sup>
    );
  }

  let label = `Source ${source.number}: ${source.name}`;

  if (source.page !== null) {
    label += `, page ${source.page}`;
  }

  return (
    <sup className="mx-0.5">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="dialog"
        title={label}
        className="inline-flex min-h-6 min-w-6 cursor-pointer items-center justify-center rounded bg-accent-soft px-1 text-xs font-medium text-accent hover:bg-selected focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
        onClick={(event) => context.onSelect(chunkId, event.currentTarget)}
      >
        [{source.number}]
      </button>
    </sup>
  );
}

type Element = NonNullable<ExtraProps["node"]>;
type Parent = Pick<Element, "children">;
const excludedTags = new Set(["pre", "code", "svg", "math"]);
const citationPattern =
  /^#knowledge-source-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

function markCitations(parent: Parent) {
  for (const child of parent.children) {
    if (child.type !== "element" || excludedTags.has(child.tagName)) {
      continue;
    }

    const href = child.properties.href;
    const citation =
      child.tagName === "a" && typeof href === "string"
        ? citationPattern.exec(href)
        : null;

    if (citation) {
      child.tagName = "span";
      child.properties = {
        "data-knowledge-citation": citation[1]!.toLowerCase(),
      };
      child.children = [];
    } else {
      markCitations(child);
    }
  }
}

// Only parsed citation links are transformed; code and ordinary links retain
// Streamdown's rendering and link-safety behavior.
export function knowledgeCitations() {
  return markCitations;
}
