import { EventType } from "@ag-ui/client";

export function normalizeRunEvent<T extends { type: EventType }>(
  event: T,
  runId: string,
): T {
  if (
    event.type !== EventType.RUN_STARTED &&
    event.type !== EventType.RUN_FINISHED
  ) {
    return event;
  }

  return { ...event, runId };
}
