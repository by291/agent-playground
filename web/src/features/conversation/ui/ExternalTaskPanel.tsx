import type { ExternalTaskSnapshot } from "@shared/external-task";

export function ExternalTaskPanel({ task }: { task: ExternalTaskSnapshot }) {
  const requiresReconciliation =
    task.continuationStatus === "submission_unknown" ||
    task.continuationStatus === "failed";

  return (
    <section
      aria-label={task.label}
      className="space-y-3 rounded-xl border border-line bg-surface p-4"
    >
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm font-medium text-ink">{task.label}</p>
        <span className="text-xs text-muted">{task.status}</span>
      </div>
      <p className="text-sm/6 text-muted" aria-live="polite">
        {task.message}
      </p>
      {task.progress !== undefined && (
        <div className="flex items-center gap-3">
          <progress
            aria-label="Task progress"
            max={100}
            value={task.progress}
            className="h-1.5 w-full accent-accent"
          />
          <span className="text-xs text-muted">{task.progress}%</span>
        </div>
      )}
      {task.error && <p className="text-sm/6 text-muted">{task.error}</p>}
      {requiresReconciliation && (
        <p className="text-sm/6 text-muted">
          The task finished, but workflow continuation requires reconciliation.
        </p>
      )}
      {task.history.length > 0 && (
        <details className="text-xs/6 text-muted">
          <summary className="cursor-pointer">Task history</summary>
          <ol className="mt-2 space-y-1">
            {task.history.map((event) => (
              <li key={event.revision}>{event.message}</li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
