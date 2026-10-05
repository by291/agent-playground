import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import type { ExternalTaskSnapshot } from "@shared/external-task";

export function ExternalTaskPanel({ task }: { task: ExternalTaskSnapshot }) {
  const requiresReconciliation =
    task.continuationStatus === "submission_unknown" ||
    task.continuationStatus === "failed";

  return (
    <section aria-label={task.label} className="motion-item-enter">
      <Card className="py-0">
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm font-medium text-ink">{task.label}</p>
            <Badge
              variant="secondary"
              key={task.status}
              className="motion-content-enter text-xs text-muted"
              role="status"
            >
              {task.status}
            </Badge>
          </div>
          <p className="text-sm/6 text-muted" aria-live="polite">
            {task.message}
          </p>
          {task.progress !== undefined && (
            <div className="flex items-center gap-3">
              <Progress
                value={task.progress}
                aria-label="Task progress"
                className="h-1.5 flex-1 bg-sidebar"
              />
              <span className="text-xs text-muted">{task.progress}%</span>
            </div>
          )}
          {task.error && (
            <Alert variant="destructive">
              <AlertDescription>{task.error}</AlertDescription>
            </Alert>
          )}
          {requiresReconciliation && (
            <p className="text-sm/6 text-muted">
              The task finished, but workflow continuation requires
              reconciliation.
            </p>
          )}
          {task.history.length > 0 && (
            <Collapsible className="text-xs/6 text-muted">
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm">
                  Task history
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <ol className="mt-2 space-y-1">
                  {task.history.map((event) => (
                    <li key={event.revision}>{event.message}</li>
                  ))}
                </ol>
              </CollapsibleContent>
            </Collapsible>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
