export const runStatuses = [
  "prepared",
  "dispatching",
  "running",
  "interrupted",
  "completed",
  "failed",
  "submission_unknown",
] as const;

export type RunStatus = (typeof runStatuses)[number];

export function isRunActive(status: RunStatus): boolean {
  return (
    status === "prepared" || status === "dispatching" || status === "running"
  );
}

export function isRunFinished(status: RunStatus): boolean {
  return (
    status === "completed" || status === "failed" || status === "interrupted"
  );
}
