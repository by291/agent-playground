import { knowledgeFileUrl, knowledgeSearchSchema } from "@shared/knowledge";
import type { toolProcess } from "../../model/turns";

export function KnowledgeSources({
  process,
}: {
  process: ReturnType<typeof toolProcess>;
}) {
  const sources = new Map<
    string,
    {
      chunkId: string;
      documentId: string;
      name: string;
      page: number | null;
      excerpt: string;
    }
  >();
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
          sources.set(source.chunkId, source);
        }
      }
    } catch {
      // Interrupted or legacy results may not carry a complete source contract.
    }
  }

  if (!searched) {
    return null;
  }

  return (
    <section
      aria-label="Retrieved sources"
      className="rounded-lg border border-line p-3 text-sm"
    >
      <p className="text-xs font-medium text-muted">Retrieved sources</p>
      {[...errors].map((error) => (
        <p key={error} className="mt-2 text-danger">
          {error}
        </p>
      ))}
      {!sources.size && !errors.size && (
        <p className="mt-2 text-muted">
          No matching sources in the current index.
        </p>
      )}
      {[...sources.values()].map((source) => (
        <details key={source.chunkId} className="mt-2">
          <summary className="cursor-pointer rounded text-sm wrap-break-word focus-visible:ring-2 focus-visible:ring-accent">
            {source.name}
            {source.page !== null && ` · Page ${source.page}`}
          </summary>
          <p className="mt-2 whitespace-pre-wrap text-muted wrap-break-word">
            {source.excerpt}
          </p>
          <a
            href={knowledgeFileUrl(source.documentId)}
            download={source.name}
            className="mt-2 inline-block rounded text-xs text-accent focus-visible:ring-2 focus-visible:ring-accent"
          >
            Download original
          </a>
        </details>
      ))}
    </section>
  );
}
