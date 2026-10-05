import { createComponentImplementation } from "@a2ui/react/v0_9";
import { sqlCardSchema, type SqlCard } from "@shared/sql-card";

export function SqlCardContent({ card }: { card: SqlCard }) {
  let status = card.check.passed ? "Check passed" : "Changes required";

  if (card.status === "submitted") {
    status = "SQL submitted";
  } else if (card.status === "abandoned") {
    status = "SQL abandoned";
  }

  return (
    <section
      aria-label="SQL workflow"
      className="motion-item-enter min-w-0 space-y-4 rounded-lg border border-line bg-surface p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-ink">SQL review</h3>
        <span
          key={`${card.revision}-${card.status}`}
          className="motion-content-enter text-xs font-medium text-accent"
        >
          Version {card.revision} · {status}
        </span>
      </div>
      <pre className="max-h-80 overflow-auto rounded-md border border-line bg-sidebar p-3 text-sm/6 text-ink">
        <code>{card.sql}</code>
      </pre>
      {card.check.issues.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm/6 text-muted">
          {card.check.issues.map((issue, index) => (
            <li key={index}>{issue}</li>
          ))}
        </ul>
      )}
      <details className="motion-details text-xs/5 text-muted">
        <summary className="cursor-pointer">Original SQL</summary>
        <pre className="mt-2 overflow-auto whitespace-pre-wrap">
          <code>{card.originalSql}</code>
        </pre>
      </details>
      {card.receiptId && (
        <p className="break-all text-xs/5 text-muted">
          Receipt: {card.receiptId}
        </p>
      )}
      {card.status === "abandoned" && (
        <p className="text-sm text-muted">Nothing was submitted.</p>
      )}
      <p className="text-xs/5 text-soft">
        Demo checks only. Submission records SQL without executing it.
      </p>
    </section>
  );
}

export const WorkflowSql = createComponentImplementation(
  { name: "WorkflowSql", schema: sqlCardSchema.strict() },
  ({ props }) => <SqlCardContent card={props} />,
);
