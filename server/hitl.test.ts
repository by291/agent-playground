import type { ResumeEntry } from "@ag-ui/client";
import assert from "node:assert/strict";
import { test } from "node:test";
import { ReviewLangGraphAgent } from "./hitl";

class TestAgent extends ReviewLangGraphAgent {
  resumeValue(entries: readonly ResumeEntry[]): unknown {
    return this.buildCommandResumeFromAgui(entries, { openInterrupts: [] });
  }
}

void test("resumes parallel reviews by LangGraph interrupt id", () => {
  const agent = new TestAgent({
    graphId: "agent",
    deploymentUrl: "http://127.0.0.1:2026",
  });

  assert.deepEqual(
    agent.resumeValue([
      {
        interruptId: "review-a",
        status: "resolved",
        payload: { decision: "approve" },
      },
      {
        interruptId: "review-b",
        status: "resolved",
        payload: { decision: "reject" },
      },
    ]),
    {
      "review-a": { decision: "approve" },
      "review-b": { decision: "reject" },
    },
  );
});

void test("preserves the adapter's single-review resume value", () => {
  const agent = new TestAgent({
    graphId: "agent",
    deploymentUrl: "http://127.0.0.1:2026",
  });

  assert.deepEqual(
    agent.resumeValue([
      {
        interruptId: "review-a",
        status: "resolved",
        payload: { decision: "approve" },
      },
    ]),
    { decision: "approve" },
  );
});
