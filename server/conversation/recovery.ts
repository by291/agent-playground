import { Client, type Run, type ThreadState } from "@langchain/langgraph-sdk";
import { langGraphInterruptsToAGUI } from "@ag-ui/langgraph";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db/database";
import { conversationRuns, type RunRow } from "../db/schema";
import { workflowOutputs } from "../db/workflow-schema";

const aegra = new Client({
  apiUrl: process.env.AEGRA_URL ?? "http://127.0.0.1:2026",
});

function externalRunId(run: Run): unknown {
  const stored = run as Run & {
    config?: { metadata?: Record<string, unknown> };
  };
  return stored.config?.metadata?.agui_run_id;
}

export async function findLatestAegraRun(
  threadId: string,
  aguiRunId: string,
): Promise<string | null> {
  // Admission permits one dispatch per thread, and Aegra lists newest runs first.
  // If the newest run is not ours, the missing callback cannot be recovered safely.
  const [latest] = await aegra.runs.list(threadId, { limit: 1 });
  return latest && externalRunId(latest) === aguiRunId ? latest.run_id : null;
}

export function interruptsFromState(state: ThreadState) {
  const interrupts = state.tasks.flatMap((task) => task.interrupts);
  return langGraphInterruptsToAGUI(interrupts);
}

export async function readThreadState(threadId: string) {
  return aegra.threads.getState(threadId);
}

export async function currentInterrupts(threadId: string) {
  const state = await readThreadState(threadId);
  return interruptsFromState(state);
}

export async function reviewCallsPersisted(
  threadId: string,
  interrupts: Awaited<ReturnType<typeof currentInterrupts>>,
): Promise<boolean> {
  const callIds = interrupts.map((interrupt) => {
    const metadata: unknown = interrupt.metadata;
    const langgraph =
      metadata && typeof metadata === "object" && "langgraph" in metadata
        ? metadata.langgraph
        : null;
    const raw =
      langgraph && typeof langgraph === "object" && "raw" in langgraph
        ? langgraph.raw
        : null;
    return raw && typeof raw === "object" && "workflowCallId" in raw
      ? raw.workflowCallId
      : null;
  });
  if (!callIds.every((id): id is string => typeof id === "string")) {
    return false;
  }

  const saved = await db
    .select({ workflowCallId: workflowOutputs.workflowCallId })
    .from(workflowOutputs)
    .where(
      and(
        eq(workflowOutputs.threadId, threadId),
        eq(workflowOutputs.stepId, "review"),
        inArray(workflowOutputs.workflowCallId, callIds),
      ),
    );
  const persisted = new Set(saved.map((row) => row.workflowCallId));
  return callIds.every((id) => persisted.has(id));
}

export async function reconcileRun(row: RunRow): Promise<RunRow> {
  if (row.status === "prepared") return row;

  let aegraRunId = row.aegraRunId;
  if (!aegraRunId) {
    // A crash may lose the callback write after Aegra accepted the run.
    try {
      aegraRunId = await findLatestAegraRun(row.threadId, row.aguiRunId);
    } catch {
      // Missing thread and transient lookup failures are equally inconclusive.
      aegraRunId = null;
    }
    if (aegraRunId) {
      await db
        .update(conversationRuns)
        .set({ aegraRunId })
        .where(
          and(
            eq(conversationRuns.aguiRunId, row.aguiRunId),
            isNull(conversationRuns.aegraRunId),
          ),
        );
    }
  }

  if (!aegraRunId) {
    const status =
      row.status === "dispatching" ? "submission_unknown" : row.status;
    await db
      .update(conversationRuns)
      .set({ status })
      .where(eq(conversationRuns.aguiRunId, row.aguiRunId));
    return { ...row, status };
  }

  const run = await aegra.runs.get(row.threadId, aegraRunId);
  const status =
    run.status === "success"
      ? "completed"
      : run.status === "interrupted"
        ? "interrupted"
        : run.status === "error" || run.status === "timeout"
          ? "failed"
          : "running";

  await db
    .update(conversationRuns)
    .set({ aegraRunId, status })
    .where(eq(conversationRuns.aguiRunId, row.aguiRunId));
  return { ...row, aegraRunId, status };
}
