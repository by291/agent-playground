import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../../db/database.js";
import { conversationRuns, type RunRow } from "../../db/conversation-schema.js";
import {
  isRunFinished,
  type RunStatus,
} from "../../../../shared/run-status.js";

// Durable status survives restarts; this map identifies dispatches still owned by this process.
const dispatchOwners = new Map<string, symbol>();

export async function claimPrepared(runId: string): Promise<boolean> {
  const rows = await db
    .update(conversationRuns)
    .set({ status: "dispatching" })
    .where(
      and(
        eq(conversationRuns.aguiRunId, runId),
        eq(conversationRuns.status, "prepared"),
      ),
    )
    .returning({ id: conversationRuns.aguiRunId });

  return rows.length === 1;
}

/** Claims once and returns the release callback for the mapping/producer lifecycle. */
export async function claimPreparedDispatch(
  runId: string,
): Promise<(() => void) | null> {
  if (dispatchOwners.has(runId)) {
    return null;
  }

  const owner = Symbol(runId);

  // Register before the claim commits so recovery cannot see an ownerless live dispatch.
  dispatchOwners.set(runId, owner);

  const release = () => {
    if (dispatchOwners.get(runId) === owner) {
      dispatchOwners.delete(runId);
    }
  };

  try {
    if (!(await claimPrepared(runId))) {
      release();

      return null;
    }

    return release;
  } catch (error) {
    release();
    throw error;
  }
}

export function hasRunDispatchOwner(runId: string): boolean {
  return dispatchOwners.has(runId);
}

export async function recordAegraRun(
  runId: string,
  aegraRunId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(conversationRuns)
      .where(eq(conversationRuns.aguiRunId, runId))
      .for("update");

    if (!row || (row.aegraRunId && row.aegraRunId !== aegraRunId)) {
      throw new Error("Aegra run mapping conflict");
    }

    // Recovery may finish the run before its creation callback reaches the database.
    await tx
      .update(conversationRuns)
      .set({
        aegraRunId,
        status: isRunFinished(row.status) ? row.status : "running",
      })
      .where(eq(conversationRuns.aguiRunId, runId));
  });
}

export async function latestRun(threadId: string): Promise<RunRow | null> {
  const [row] = await db
    .select()
    .from(conversationRuns)
    .where(eq(conversationRuns.threadId, threadId))
    .orderBy(desc(conversationRuns.submitSeq))
    .limit(1);

  return row ?? null;
}

/** Writes only if the status and upstream mapping still match the observed row. */
export async function saveRunObservation(
  expected: RunRow,
  observation: { status: RunStatus; aegraRunId: string | null },
): Promise<RunRow> {
  // An upstream read cannot overwrite a callback or a newer terminal observation.
  const [updated] = await db
    .update(conversationRuns)
    .set(observation)
    .where(
      and(
        eq(conversationRuns.aguiRunId, expected.aguiRunId),
        eq(conversationRuns.status, expected.status),
        expected.aegraRunId === null
          ? isNull(conversationRuns.aegraRunId)
          : eq(conversationRuns.aegraRunId, expected.aegraRunId),
      ),
    )
    .returning();

  if (updated) {
    return updated;
  }

  const [current] = await db
    .select()
    .from(conversationRuns)
    .where(eq(conversationRuns.aguiRunId, expected.aguiRunId));

  if (!current) {
    throw new Error("Conversation run disappeared during recovery");
  }

  return current;
}
