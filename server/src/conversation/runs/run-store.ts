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
const DISPATCH_DRAIN_TIMEOUT_MS = 5_000;
const databaseTime = sql`clock_timestamp()`;
const nextDispatchExpiration = sql`
  ${databaseTime} + make_interval(secs => ${DISPATCH_LEASE_SECONDS})
`;
const clearedDispatch = {
  dispatchToken: null,
  dispatchLeaseUntil: null,
};

type ReleaseDispatch = () => Promise<void>;

const activeDispatches = new Set<Promise<void>>();
let isDrainingDispatches = false;

function trackDispatch() {
  let resolveCompletion!: () => void;
  const completion = new Promise<void>((resolve) => {
    resolveCompletion = resolve;
  });

  activeDispatches.add(completion);

  return () => {
    activeDispatches.delete(completion);
    resolveCompletion();
  };
}

/** Stop taking dispatches and give in-flight creation receipts time to persist. */
export async function drainRunDispatches(): Promise<void> {
  isDrainingDispatches = true;

  if (activeDispatches.size === 0) {
    return;
  }

  const timeout = new AbortController();

  try {
    const drained = await Promise.race([
      Promise.all(activeDispatches).then(() => true),
      delay(DISPATCH_DRAIN_TIMEOUT_MS, undefined, { signal: timeout.signal }),
    ]);

    if (!drained) {
      // The durable lease and upstream identity allow another replica to reconcile.
      logger.warn(
        { active_dispatches: activeDispatches.size },
        "Run dispatch drain timed out",
      );
    }
  } finally {
    timeout.abort();
  }
}

async function renewDispatchLease(
  runId: string,
  token: string,
): Promise<boolean> {
  const leaseRenewal = db
    .update(conversationRuns)
    .set({ dispatchLeaseUntil: nextDispatchExpiration })
    .where(
      and(
        eq(conversationRuns.aguiRunId, runId),
        eq(conversationRuns.dispatchToken, token),
        eq(conversationRuns.status, "dispatching"),
        gt(conversationRuns.dispatchLeaseUntil, databaseTime),
      ),
    );

  const renewed = await leaseRenewal.returning({
    id: conversationRuns.aguiRunId,
  });

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
  if (isDrainingDispatches) {
    return null;
  }

  // Register before the first await so shutdown sees claims still in PostgreSQL.
  const finishDispatch = trackDispatch();

  try {
    const token = randomUUID();
    const dispatchClaim = db
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
      );

    const rows = await dispatchClaim.returning({
      id: conversationRuns.aguiRunId,
    });

    if (rows.length === 0) {
      finishDispatch();

      return null;
    }

    const release = ownDispatchLease(runId, token);

    return async () => {
      try {
        await release();
      } finally {
        finishDispatch();
      }
    };
  } catch (error) {
    finishDispatch();
    throw error;
  }
}

/** Records a confirmed upstream identity even if the dispatch lease has expired. */
export async function recordAegraRun(
  runId: string,
  aegraRunId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const runLockQuery = tx
      .select()
      .from(conversationRuns)
      .where(eq(conversationRuns.aguiRunId, runId));

    const [row] = await runLockQuery.for("update");

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
  const latestRunQuery = db
    .select()
    .from(conversationRuns)
    .where(eq(conversationRuns.threadId, threadId));

  const [row] = await latestRunQuery
    .orderBy(desc(conversationRuns.submitSeq))
    .limit(1);

  return row ?? null;
}

/**
 * Compare the observed status and mapping before writing. An unknown outcome
 * also requires an expired or released dispatch lease.
 */
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
  const observationUpdate = db
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
    );

  const [updated] = await observationUpdate.returning();

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
