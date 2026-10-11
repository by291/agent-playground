// @vitest-environment jsdom
import { test } from "vitest";
import assert from "node:assert/strict";
import { createElement } from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ExternalTaskSnapshot } from "@shared/external-task";
import { ExternalTaskPanel } from "./ExternalTaskPanel";

const proposal = [
  "## Revised workshop",
  "",
  "A **practical** agent exercise.",
  "",
  "| Time | Activity |",
  "| --- | --- |",
  "| 10 min | Agent handoff |",
  "",
  "- Capture the task ID",
  "- Verify completion",
  "",
  "```json",
  '{ "state": "completed" }',
  "```",
].join("\n");

function collaboration(): ExternalTaskSnapshot {
  return {
    taskId: "job-1",
    workflowCallId: "call-1",
    label: "A2A collaboration",
    kind: "a2a",
    revision: 4,
    status: "succeeded",
    stage: "revise",
    message: "The agents completed the revision.",
    history: [],
    continuationStatus: null,
    outputs: [
      {
        agent: "Planner",
        step: "plan",
        taskId: "draft-1",
        contextId: "planner-1",
        status: "succeeded",
        text: "## Initial draft\n\nDraft details.",
      },
      {
        agent: "Reviewer",
        step: "review",
        taskId: "review-1",
        contextId: "reviewer-1",
        status: "succeeded",
        text: "## Reviewer feedback\n\nAdd a completion check.",
      },
      {
        agent: "Planner",
        step: "revise",
        taskId: "revision-1",
        contextId: "planner-1",
        status: "succeeded",
        text: proposal,
      },
    ],
  };
}

test("restored A2A results render Markdown while earlier handoffs stay compact", async () => {
  render(createElement(ExternalTaskPanel, { task: collaboration() }));
  const revision = within(screen.getByLabelText("Planner revise"));

  assert.ok(
    revision.getByRole("heading", { name: "Revised workshop", level: 2 }),
  );
  assert.ok(revision.getByRole("table"));
  assert.ok(
    revision.getByText("practical").closest('[data-streamdown="strong"]'),
  );
  assert.ok(revision.getByText("Capture the task ID").closest("li"));
  await waitFor(() => assert.ok(revision.getByText(/"state"/).closest("pre")));
  assert.ok(screen.queryByRole("heading", { name: "Initial draft" }) === null);
  assert.ok(
    screen.queryByRole("heading", { name: "Reviewer feedback" }) === null,
  );
  assert.ok(screen.getByText("Coordinator → Reviewer"));
  assert.ok(screen.getByText("Revise using Reviewer's feedback."));

  fireEvent.click(screen.getByRole("button", { name: /Draft · Planner/ }));
  assert.ok(screen.getByRole("heading", { name: "Initial draft" }));
});

test("the active handoff opens as streamed snapshots replace its output", async () => {
  const complete = collaboration();
  const task: ExternalTaskSnapshot = {
    ...complete,
    status: "running",
    stage: "plan",
    outputs: [
      {
        ...complete.outputs![0]!,
        status: "running",
        text: "## Draft\n\nFirst",
      },
    ],
  };
  const view = render(createElement(ExternalTaskPanel, { task }));

  assert.ok(screen.getByRole("heading", { name: "Draft", level: 2 }));
  view.rerender(
    createElement(ExternalTaskPanel, {
      task: {
        ...task,
        stage: "review",
        outputs: [
          {
            ...task.outputs![0]!,
            status: "succeeded",
            text: "## Draft\n\nFirst second",
          },
          { ...complete.outputs![1]!, status: "running" },
        ],
      },
    }),
  );
  assert.ok(
    screen.getByRole("heading", { name: "Reviewer feedback", level: 2 }),
  );
  await waitFor(() =>
    assert.ok(
      screen.queryByRole("heading", { name: "Draft", level: 2 }) === null,
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: /Draft · Planner/ }));
  assert.ok(screen.getByText("First second"));
  assert.ok(screen.queryByText("First") === null);
});

test("queued collaboration shows the three handoffs before output arrives", () => {
  render(
    createElement(ExternalTaskPanel, {
      task: {
        ...collaboration(),
        status: "queued",
        stage: "plan",
        outputs: [],
      },
    }),
  );

  assert.ok(screen.getByLabelText("Planner plan"));
  assert.ok(screen.getByLabelText("Reviewer review"));
  assert.ok(screen.getByLabelText("Planner revise"));
  assert.ok(screen.queryByRole("button", { name: /Draft · Planner/ }) === null);
});

test("interrupted collaboration keeps its last partial output visible", () => {
  const complete = collaboration();

  render(
    createElement(ExternalTaskPanel, {
      task: {
        ...complete,
        status: "cancelled",
        stage: "review",
        outputs: [
          complete.outputs![0]!,
          {
            ...complete.outputs![1]!,
            status: "cancelled",
            text: "## Partial feedback\n\nCheck the handoff.",
          },
        ],
      },
    }),
  );

  assert.ok(
    screen.getByRole("heading", { name: "Partial feedback", level: 2 }),
  );
  assert.ok(
    within(screen.getByLabelText("Planner revise")).getByText("Not started"),
  );
});
