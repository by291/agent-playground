// @vitest-environment jsdom
import { test, vi } from "vitest";
import assert from "node:assert/strict";
import { createElement } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ExternalTaskPanel } from "./ExternalTaskPanel";
import type { ExternalTaskSnapshot } from "@shared/external-task";

test("child output updates in place and input is submitted to the owning task", async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}"));

  vi.stubGlobal("fetch", request);
  const task = {
    taskId: "job-1",
    workflowCallId: "call-1",
    label: "A2A collaboration",
    kind: "a2a",
    revision: 1,
    status: "running",
    stage: "plan",
    message: "Planning",
    history: [],
    continuationStatus: null,
    outputs: [
      {
        agent: "Planner",
        step: "plan",
        taskId: "remote-1",
        contextId: "context-1",
        status: "running",
        text: "First",
      },
    ],
  } as ExternalTaskSnapshot;
  const view = render(createElement(ExternalTaskPanel, { task }));

  assert.ok(screen.getByText("First"));
  view.rerender(
    createElement(ExternalTaskPanel, {
      task: {
        ...task,
        revision: 2,
        status: "input_required",
        message: "Audience?",
        outputs: [
          {
            ...task.outputs![0]!,
            text: "First second",
            status: "input_required",
          },
        ],
      },
    }),
  );
  assert.ok(screen.getByText("First second"));
  assert.equal(screen.queryByText("First"), null);
  fireEvent.change(screen.getByLabelText("Additional information"), {
    target: { value: "Engineering team" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Continue agents" }));
  await waitFor(() => assert.equal(request.mock.calls.length, 1));
  assert.equal(request.mock.calls[0]![0], "/external-tasks/job-1/input");
  const requestBody = request.mock.calls[0]![1]?.body;

  assert.ok(typeof requestBody === "string");
  const submitted: unknown = JSON.parse(requestBody);

  assert.deepEqual(submitted, { input: "Engineering team" });
});

function collaboration(
  status: ExternalTaskSnapshot["status"],
): ExternalTaskSnapshot {
  return {
    taskId: "job-1",
    workflowCallId: "call-1",
    label: "A2A collaboration",
    kind: "a2a",
    revision: 1,
    status,
    stage: "plan",
    message: "Planning",
    history: [],
    continuationStatus: null,
  };
}

test("cancellation waits for the callback and failed controls can be retried", async () => {
  let completeRequest: (response: Response) => void = () => {
    assert.fail("The control request did not start");
  };
  const request = vi
    .fn<typeof fetch>()
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          completeRequest = resolve;
        }),
    )
    .mockResolvedValueOnce(new Response("{}"));

  vi.stubGlobal("fetch", request);
  render(createElement(ExternalTaskPanel, { task: collaboration("running") }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel agents" }));
  assert.equal(
    screen
      .getByRole("button", { name: "Cancelling agents…" })
      .hasAttribute("disabled"),
    true,
  );
  assert.ok(screen.getByRole("status").textContent?.includes("running"));
  completeRequest(
    new Response(JSON.stringify({ error: "The agents already finished" }), {
      status: 409,
    }),
  );
  await waitFor(() =>
    assert.ok(screen.getByText("The agents already finished")),
  );
  assert.equal(request.mock.calls[0]![0], "/external-tasks/job-1/cancel");
  fireEvent.click(screen.getByRole("button", { name: "Cancel agents" }));
  await waitFor(() => assert.equal(request.mock.calls.length, 2));
  await waitFor(() =>
    assert.equal(screen.queryByText("The agents already finished"), null),
  );
});

test("only active A2A tasks expose agent controls", () => {
  const task = collaboration("input_required");
  const view = render(createElement(ExternalTaskPanel, { task }));

  assert.ok(
    screen
      .getByRole("button", { name: "Continue agents" })
      .hasAttribute("disabled"),
  );
  assert.ok(screen.getByRole("button", { name: "Cancel agents" }));
  view.rerender(
    createElement(ExternalTaskPanel, {
      task: { ...task, status: "cancelled" },
    }),
  );
  assert.equal(screen.queryByRole("button", { name: "Cancel agents" }), null);
  view.rerender(
    createElement(ExternalTaskPanel, { task: { ...task, kind: undefined } }),
  );
  assert.equal(screen.queryByLabelText("Additional information"), null);
});

test("unmount releases a pending control request", async () => {
  const request = vi.fn<typeof fetch>().mockImplementation(
    (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      }),
  );

  vi.stubGlobal("fetch", request);
  const view = render(
    createElement(ExternalTaskPanel, { task: collaboration("queued") }),
  );

  fireEvent.click(screen.getByRole("button", { name: "Cancel agents" }));
  const signal = request.mock.calls[0]?.[1]?.signal;

  assert.ok(signal);
  view.unmount();
  await waitFor(() => assert.equal(signal.aborted, true));
});
