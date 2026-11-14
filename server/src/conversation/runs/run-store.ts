import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { and, desc, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "../../db/database.js";
import { logger } from "../../observability/logger.js";
import { conversationRuns, type RunRow } from "../../db/conversation-schema.js";
import {
  isRunFinished,
  type RunStatus,
} from "../../../../shared/run-status.js";

const DISPATCH_LEASE_SECONDS = 30;
const DISPATCH_HEARTBEAT_MS = 10_000;
const databaseTime = sql`clock_timestamp()`;
const nextDispatchExpiration = sql`
  ${databaseTime} + make_interval(secs => ${DISPATCH_LEASE_SECONDS})
`;
const clearedDispatch = {
  dispatchToken: null,
  dispatchLeaseUntil: null,
};

type ReleaseDispatch = () => Promise<void>;

async function renewDispatchLease(
  runId: string,
  token: string,
): Promise<boolean> {
  const renewed = await db
    .update(conversationRuns)
    .set({ dispatchLeaseUntil: nextDispatchExpiration })
    .where(
      and(
        eq(conversationRuns.aguiRunId, runId),
        eq(conversationRuns.dispatchToken, token),
        eq(conversationRuns.status, "dispatching"),
        gt(conversationRuns.dispatchLeaseUntil, databaseTime),
      ),
    )
    .returning({ id: conversationRuns.aguiRunId });

  return renewed.length === 1;
}

async function keepDispatchLease(
  runId: string,
  token: string,
  signal: AbortSignal,
): Promise<void> {
  while (!signal.aborted) {
    try {
      await delay(DISPATCH_HEARTBEAT_MS, undefined, { signal, ref: false });

      if (signal.aborted || !(await renewDispatchLease(runId, token))) {
        return;
      }
    } catch (error) {
      if (signal.aborted) {
        return;
      }

      logger.warn(
        { err: error, run_id: runId },
        "Dispatch lease renewal failed",
      );
    }
  }
}

function ownDispatchLease(runId: string, token: string): ReleaseDispatch {
  const controller = new AbortController();
  const heartbeat = keepDispatchLease(runId, token, controller.signal);
  let releasing: Promise<void> | undefined;

  async function release() {
    controller.abort();
    await heartbeat;

    try {
      await db
        .update(conversationRuns)
        .set(clearedDispatch)
        .where(
          and(
            eq(conversationRuns.aguiRunId, runId),
            eq(conversationRuns.dispatchToken, token),
          ),
        );
    } catch (error) {
      // Recovery can still use the persisted expiration after a failed release.
      logger.warn(
        { err: error, run_id: runId },
        "Dispatch lease release failed",
      );
    }
  }

  return () => (releasing ??= release());
}

/** Atomically claims a prepared run and maintains its lease until released. */
export async function claimPreparedDispatch(
  runId: string,
): Promise<ReleaseDispatch | null> {
  const token = randomUUID();
  const rows = await db
    .update(conversationRuns)
    .set({
      status: "dispatching",
      dispatchToken: token,
      dispatchLeaseUntil: nextDispatchExpiration,
    })
    .where(
      and(
        eq(conversationRuns.aguiRunId, runId),
        eq(conversationRuns.status, "prepared"),
      ),
    )
    .returning({ id: conversationRuns.aguiRunId });

  return rows.length === 1 ? ownDispatchLease(runId, token) : null;
}

/** Records a confirmed upstream identity even if the dispatch lease has expired. */
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
        ...clearedDispatch,
        aegraRunId,
        status: isRunFinished(row.status) ? row.status : "running",
      })
      .where(eq(conversationRuns.aguiRunId, runId));
  });
}

/** Reads the most recently admitted run for the conversation. */
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
  // A heartbeat may have renewed the lease while the upstream lookup was in flight.
  const requiresExpiredLease = observation.status === "submission_unknown";
  const expiredLease = requiresExpiredLease
    ? or(
        isNull(conversationRuns.dispatchLeaseUntil),
        lte(conversationRuns.dispatchLeaseUntil, databaseTime),
      )
    : undefined;

  // An upstream read cannot overwrite a callback or a newer terminal observation.
  const [updated] = await db
    .update(conversationRuns)
    .set({ ...observation, ...clearedDispatch })
    .where(
      and(
        eq(conversationRuns.aguiRunId, expected.aguiRunId),
        eq(conversationRuns.status, expected.status),
        expected.aegraRunId === null
          ? isNull(conversationRuns.aegraRunId)
          : eq(conversationRuns.aegraRunId, expected.aegraRunId),
        expiredLease,
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
