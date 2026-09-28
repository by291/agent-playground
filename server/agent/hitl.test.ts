import { test } from "vitest";
import type { ResumeEntry } from "@ag-ui/client";
import assert from "node:assert/strict";
import { ReviewLangGraphAgent } from "./hitl";
import { prepareAegraRequest } from "./client";

test("sends only the resume command to Aegra", () => {
  const url = new URL("http://127.0.0.1:2026/threads/thread/runs/stream");
  const init = {
    method: "POST",
    body: JSON.stringify({
      input: { messages: [] },
      command: { resume: "approve" },
    }),
  };
  const result = prepareAegraRequest(url, init);
  const body = JSON.parse(result.body as string) as {
    command: unknown;
    input?: unknown;
  };

  assert.deepEqual(body.command, { resume: "approve" });
  assert.equal("input" in body, false);
});

class TestAgent extends ReviewLangGraphAgent {
  resumeValue(entries: readonly ResumeEntry[]): unknown {
    return this.buildCommandResumeFromAgui(entries, { openInterrupts: [] });
  }
}

test("resumes parallel reviews by LangGraph interrupt id", () => {
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

test("preserves the adapter's single-review resume value", () => {
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
