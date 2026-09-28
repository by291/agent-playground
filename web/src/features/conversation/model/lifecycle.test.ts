import assert from "node:assert/strict";
import test from "node:test";
import {
  initialLifecycle,
  snapshotPolicy,
  transitionLifecycle,
} from "./lifecycle";

void test("a fresh submission stays query-free until its stream settles", () => {
  const initial = initialLifecycle({
    threadId: "fresh",
    fresh: true,
    empty: true,
  });
  const submitting = transitionLifecycle(initial, {
    type: "submission-started",
  });

  assert.equal(submitting.hydration, "ready");
  assert.equal(submitting.execution, "submitting");
  assert.equal(submitting.emptyHint, false);
  assert.deepEqual(snapshotPolicy(submitting), {
    enabled: false,
    polling: false,
  });
  const streaming = transitionLifecycle(submitting, { type: "stream-started" });
  const failedRefresh = transitionLifecycle(streaming, {
    type: "snapshot-failed",
    locallyActive: true,
  });

  assert.equal(failedRefresh.execution, "streaming");
  assert.deepEqual(snapshotPolicy(failedRefresh), {
    enabled: false,
    polling: false,
  });
  const settled = transitionLifecycle(streaming, { type: "stream-settled" });

  assert.equal(settled.execution, "awaiting-snapshot");
  assert.deepEqual(snapshotPolicy(settled), { enabled: true, polling: true });
  assert.equal(
    initial.hydration,
    "fresh",
    "Transitions do not mutate the previous state",
  );
});

void test("restored runs and output gaps keep distinct execution and synchronization states", () => {
  const initial = initialLifecycle({ threadId: "restored", empty: true });
  const running = transitionLifecycle(initial, {
    type: "snapshot-received",
    locallyActive: false,
    running: true,
    needsRecovery: true,
    empty: false,
  });

  assert.equal(running.hydration, "ready");
  assert.equal(running.execution, "recovering-run");
  assert.deepEqual(snapshotPolicy(running), { enabled: true, polling: true });
  const gap = transitionLifecycle(running, {
    type: "snapshot-received",
    locallyActive: false,
    running: false,
    needsRecovery: true,
    empty: false,
  });

  assert.equal(
    gap.execution,
    "idle",
    "Missing output does not invent an active run",
  );
  assert.equal(snapshotPolicy(gap).polling, true);
  const ready = transitionLifecycle(gap, {
    type: "snapshot-received",
    locallyActive: false,
    running: false,
    needsRecovery: false,
    empty: false,
  });

  assert.equal(ready.execution, "idle");
  assert.deepEqual(snapshotPolicy(ready), { enabled: true, polling: false });
});

void test("a recovery error keeps initialization blocked and enables polling", () => {
  const initial = initialLifecycle({ threadId: "restore" });
  const failed = transitionLifecycle(initial, {
    type: "snapshot-failed",
    locallyActive: false,
  });

  assert.equal(failed.hydration, "restoring");
  assert.deepEqual(snapshotPolicy(failed), { enabled: true, polling: true });
});
