import { useEffect, useId, useRef, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import {
  isExternalTaskTerminal,
  type ExternalTaskSnapshot,
} from "@shared/external-task";
import {
  controlExternalTask,
  externalTaskControlError,
} from "../../api/external-tasks";
import { AgentTaskOutputs } from "./AgentTaskOutputs";

const maximumInputCharacters = 4000;

function AgentTaskControls({ task }: { task: ExternalTaskSnapshot }) {
  const inputId = useId();
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<"input" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const request = useRef<AbortController | null>(null);

  // The request belongs to this card; late responses must not update an unmounted control.
  useEffect(() => () => request.current?.abort(), []);

  async function control(action: "input" | "cancel") {
    if (request.current) {
      return;
    }

    const controller = new AbortController();

    request.current = controller;
    setPending(action);
    setError(null);

    try {
      await controlExternalTask({
        taskId: task.taskId,
        action,
        input: input.trim(),
        signal: controller.signal,
      });

      if (!controller.signal.aborted && action === "input") {
        setInput("");
      }
    } catch (failure) {
      if (!controller.signal.aborted) {
        setError(
          failure instanceof Error ? failure.message : externalTaskControlError,
        );
      }
    } finally {
      if (request.current === controller) {
        request.current = null;

        if (!controller.signal.aborted) {
          setPending(null);
        }
      }
    }
  }

  return (
    <div className="space-y-3">
      {task.status === "input_required" && (
        <div className="space-y-2">
          <label htmlFor={inputId} className="text-sm font-medium text-ink">
            Additional information
          </label>
          <Textarea
            id={inputId}
            value={input}
            maxLength={maximumInputCharacters}
            disabled={pending !== null}
            onChange={(event) => setInput(event.target.value)}
          />
          <Button
            type="button"
            disabled={pending !== null || !input.trim()}
            onClick={() => void control("input")}
          >
            {pending === "input" ? "Continuing agents…" : "Continue agents"}
          </Button>
        </div>
      )}
      <Button
        type="button"
        variant="outline"
        disabled={pending !== null}
        onClick={() => void control("cancel")}
      >
        {pending === "cancel" ? "Cancelling agents…" : "Cancel agents"}
      </Button>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

/** Displays the saved task progress and exposes controls while the task can act. */
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
          {task.kind === "a2a" && (
            <p className="text-sm/6 text-muted">
              You → Coordinator. The coordinator delegates each step and streams
              the agents' output here.
            </p>
          )}
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
          {(task.kind === "a2a" || task.outputs) && (
            <AgentTaskOutputs key={`outputs-${task.taskId}`} task={task} />
          )}
          {task.kind === "a2a" && !isExternalTaskTerminal(task.status) && (
            <AgentTaskControls key={`controls-${task.taskId}`} task={task} />
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
