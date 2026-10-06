// @vitest-environment jsdom
import { fireEvent, render, waitFor } from "@testing-library/react";
import { createElement, Fragment } from "react";
import { HttpAgent, InterruptSchema } from "@ag-ui/client";
import { expect, onTestFinished, test, vi } from "vitest";
import { useStore } from "zustand";
import { parseWorkflowReview } from "@shared/workflow-review";
import { parsePlanReview } from "./model/planReview";
import { createConversationSession } from "./runtime/session";
import { ReviewPanel } from "./ui/review/ReviewPanel";
import { WorkflowReviewPanel } from "./ui/review/WorkflowReviewPanel";

test.each(["plan", "workflow"] as const)(
  "%s review journal failures display the session issue and preserve the review",
  async (kind) => {
    const fetch = vi.fn(() =>
      Promise.reject(new Error("Unexpected agent request")),
    );
    const session = createConversationSession(
      { threadId: "review-storage" },
      new HttpAgent({ threadId: "review-storage", url: "/agent", fetch }),
    );
    const interrupt = InterruptSchema.parse({
      id: "review",
      reason: "Review the draft",
      metadata: {
        langgraph: {
          raw:
            kind === "plan"
              ? {
                  kind: "experiment_plan_review",
                  title: "Saved plan",
                  steps: ["Try it"],
                }
              : {
                  kind: "workflow_review",
                  workflowCallId: "call",
                  revision: 1,
                  round: 1,
                  outputStepId: "output",
                  canAccept: true,
                  title: "Review output",
                  acceptLabel: "Accept version",
                },
        },
      },
    });
    const disconnect = session.connect(() => Promise.resolve());

    onTestFinished(disconnect);
    session.receiveSnapshot({
      messages: [],
      outputs: [],
      runs: [{ runId: "initial", status: "interrupted" }],
      interrupts: [interrupt],
    });

    function Reviews() {
      const issue = useStore(session.store, (state) => state.issues.run);

      return createElement(
        Fragment,
        null,
        issue && createElement("p", { role: "alert" }, issue),
        kind === "plan"
          ? createElement(ReviewPanel, {
              reviews: [parsePlanReview(interrupt)!],
              running: false,
              onReview: session.store.getState().reviewPlan,
            })
          : createElement(WorkflowReviewPanel, {
              reviews: [parseWorkflowReview(interrupt)!],
              running: false,
              onReview: session.store.getState().reviewWorkflow,
            }),
      );
    }

    const view = render(createElement(Reviews));

    if (kind === "plan") {
      fireEvent.change(view.getByRole("textbox", { name: "Title" }), {
        target: { value: "Edited plan" },
      });
    }

    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });
    fireEvent.click(
      view.getByRole("button", {
        name: kind === "plan" ? "Approve plan" : "Accept version",
      }),
    );
    await waitFor(() =>
      expect(view.getByRole("alert")).toHaveTextContent(
        /Cannot save this submission/,
      ),
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(session.store.getState().pendingInterrupts).toEqual([interrupt]);

    if (kind === "plan") {
      expect(view.getByRole("textbox", { name: "Title" })).toHaveValue(
        "Edited plan",
      );
    } else {
      expect(
        view.getByRole("button", { name: "Accept version" }),
      ).toBeEnabled();
      fireEvent.click(view.getByRole("button", { name: "Abandon" }));
      await waitFor(() =>
        expect(view.getByRole("alert")).toHaveTextContent(
          /Cannot save this submission/,
        ),
      );
    }
  },
);
