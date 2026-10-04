import { expect, test } from "vitest";
import { reconcileSnapshot } from "./reconciliation";

test("a backend continuation supersedes a finished local submission", () => {
  const result = reconcileSnapshot(
    {
      messages: [
        {
          id: "reply",
          role: "assistant",
          content: "Finished in the background",
        },
      ],
      outputs: [],
      interrupts: [],
      runs: [
        { runId: "submitted", status: "interrupted" },
        { runId: "background", status: "completed" },
      ],
    },
    {
      submittedRunId: "submitted",
      submitting: false,
      streaming: false,
      messages: [],
      interrupts: undefined,
    },
  );

  expect(result.kind).toBe("current");
  expect("messages" in result && result.messages[0]?.content).toBe(
    "Finished in the background",
  );
});
