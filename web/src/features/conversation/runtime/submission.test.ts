import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { HttpAgent, type Interrupt } from "@ag-ui/client";
import { createSubmissionRunner } from "./submission";

test.each(["request-rejected", "unconfirmed-stream", "accepted-disconnect"])(
  "a failed partial resume restores every pending interrupt for retry: %s",
  async (failure) => {
    const interrupts: Interrupt[] = [
      { id: "review", reason: "Review the operation" },
      { id: "other-wait", reason: "An independent pause" },
    ];
    const agent: HttpAgent = new HttpAgent({
      threadId: "thread",
      url: "/agent",
      fetch: () => {
        assert.deepEqual(agent.pendingInterrupts, [interrupts[0]]);

        if (failure === "request-rejected") {
          return Promise.reject(new Error("Connection lost before admission"));
        }

        const events =
          failure === "accepted-disconnect"
            ? [
                { type: "RUN_STARTED", threadId: "thread", runId: "resume" },
                {
                  type: "RUN_ERROR",
                  message: "Connection lost after admission",
                },
              ]
            : [];

        return Promise.resolve(
          new Response(
            events
              .map((event) => `data: ${JSON.stringify(event)}\n\n`)
              .join(""),
            {
              headers: { "Content-Type": "text/event-stream" },
            },
          ),
        );
      },
    });

    agent.pendingInterrupts = interrupts;
    const runner = createSubmissionRunner(() => "thread", agent, {
      started: vi.fn(),
      failed(_error, accepted) {
        assert.equal(accepted, failure === "accepted-disconnect");
      },
      settled: () => Promise.resolve(),
    });

    const completion = runner.run({
      runId: "resume",
      messageId: "resume",
      messages: [],
      state: {},
      resume: [
        {
          interruptId: "review",
          status: "resolved",
          payload: { decision: "approve" },
        },
      ],
    });

    if (failure === "accepted-disconnect") {
      await completion;
    } else {
      await assert.rejects(completion);
    }

    assert.equal(agent.pendingInterrupts, interrupts);
    assert.equal(runner.active, false);
  },
);
