import { test } from "vitest";
import { EventType } from "@ag-ui/client";
import assert from "node:assert/strict";
import { normalizeRunEvent } from "./run-events.js";

test("normalizes both terminal and start IDs across adapter mutation", () => {
  const expected = "client-run";
  const started = normalizeRunEvent(
    { type: EventType.RUN_STARTED, runId: expected, threadId: "thread" },
    expected,
  );
  const finished = normalizeRunEvent(
    { type: EventType.RUN_FINISHED, runId: "aegra-run", threadId: "thread" },
    expected,
  );

  assert.equal(started.runId, expected);
  assert.equal(finished.runId, expected);
});
