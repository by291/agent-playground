import type { ExternalTaskSnapshot } from "@shared/external-task";

export function ExternalTaskPanel({ task }: { task: ExternalTaskSnapshot }) {
  const requiresReconciliation =
    task.continuationStatus === "submission_unknown" ||
    task.continuationStatus === "failed";

  return (
    <section
      aria-label={task.label}
      className="motion-item-enter space-y-3 rounded-xl border border-line bg-surface p-4"
    >
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm font-medium text-ink">{task.label}</p>
        <span
          key={task.status}
          className="motion-content-enter text-xs text-muted"
          role="status"
        >
          {task.status}
        </span>
      </div>
      <p className="text-sm/6 text-muted" aria-live="polite">
        {task.message}
      </p>
      {task.progress !== undefined && (
        <div className="flex items-center gap-3">
          <div
            role="progressbar"
            aria-label="Task progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={task.progress}
            className="h-1.5 w-full overflow-hidden rounded-full bg-sidebar"
          >
            <div
              className="motion-progress h-full rounded-full bg-accent"
              style={{ transform: `scaleX(${task.progress / 100})` }}
            />
          </div>
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
        <details className="motion-details text-xs/6 text-muted">
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
