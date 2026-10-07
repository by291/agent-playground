import type { Client, Run } from "@langchain/langgraph-sdk";
import { aegra } from "../agent/client";
import type { RunRow } from "../db/schema";
import { isRunFinished, type RunStatus } from "../../shared/run-status";
import { hasRunDispatchOwner, saveRunObservation } from "./run-store";

function externalRunId(run: Run): unknown {
  const stored = run as Run & {
    config?: { metadata?: Record<string, unknown> };
  };

  return stored.config?.metadata?.agui_run_id;
}

export async function findLatestAegraRun(
  threadId: string,
  aguiRunId: string,
  client: Client = aegra,
) {
  // One dispatch is admitted per thread. An unmatched newest run is inconclusive.
  const [latest] = await client.runs.list(threadId, { limit: 1 });

  return latest && externalRunId(latest) === aguiRunId ? latest.run_id : null;
}

function localStatus(status: Run["status"]): RunStatus {
  switch (status) {
    case "success":
      return "completed";
    case "interrupted":
      return "interrupted";
    case "error":
    case "timeout":
      return "failed";
    default:
      return "running";
  }
}

export async function reconcileRun(
  row: RunRow,
  client: Client = aegra,
): Promise<RunRow> {
  if (row.status === "prepared" || isRunFinished(row.status)) {
    return row;
  }

  let aegraRunId = row.aegraRunId;

  if (!aegraRunId) {
    try {
      aegraRunId = await findLatestAegraRun(
        row.threadId,
        row.aguiRunId,
        client,
      );
    } catch {
      // A failed creation lookup cannot prove whether Aegra accepted the submission.
    }
  }

  if (!aegraRunId) {
    const outcomeUnknown =
      row.status === "dispatching" && !hasRunDispatchOwner(row.aguiRunId);

    return saveRunObservation(row, {
      aegraRunId: null,
      status: outcomeUnknown ? "submission_unknown" : row.status,
    });
  }

  const run = await client.runs.get(row.threadId, aegraRunId);

  return saveRunObservation(row, {
    aegraRunId,
    status: localStatus(run.status),
  });
}
