// @vitest-environment jsdom
import { test, onTestFinished, vi, expect } from "vitest";
import assert from "node:assert/strict";
import { createElement } from "react";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConversationProvider } from "../ConversationProvider";
import type { ConversationSnapshot } from "../api/contracts";
import { ConversationWorkspace } from "./ConversationWorkspace";

function renderWorkspace(snapshot: ConversationSnapshot | null = null) {
  const client = new QueryClient();
  const conversation = {
    threadId: "navigation",
    ...(snapshot === null ? { fresh: true as const } : {}),
    empty: snapshot === null,
  };

  onTestFinished(() => client.clear());
  vi.stubGlobal("fetch", (url: string) => {
    if (url === "/health") {
      return Promise.resolve(new Response());
    }

    return Promise.resolve(Response.json(snapshot));
  });
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: () => undefined,
  });
  onTestFinished(() => {
    Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
  });

  return render(
    createElement(
      QueryClientProvider,
      { client },
      createElement(ConversationProvider, {
        conversation,
        children: createElement(ConversationWorkspace, {
          conversation,
          development: false,
          onNewConversation: () => undefined,
        }),
      }),
    ),
  );
}

test("collapsing and expanding navigation preserves the unsent composer draft", () => {
  const page = renderWorkspace();
  const input = page.getByRole("textbox", {
    name: "Message",
  }) as HTMLTextAreaElement;

  fireEvent.change(input, { target: { value: "Keep this unfinished task" } });
  fireEvent.click(page.getByRole("button", { name: "Collapse sidebar" }));

  assert.equal(
    page
      .getByRole("button", { name: "Expand sidebar" })
      .getAttribute("aria-expanded"),
    "false",
  );
  assert.equal(page.getByRole("textbox", { name: "Message" }), input);
  assert.equal(input.value, "Keep this unfinished task");
  fireEvent.click(page.getByRole("button", { name: "Expand sidebar" }));

  assert.equal(
    page
      .getByRole("button", { name: "Collapse sidebar" })
      .getAttribute("aria-expanded"),
    "true",
  );
  assert.equal(input.value, "Keep this unfinished task");
});

test("welcome suggestions prepare an editable draft before starting a run", () => {
  const page = renderWorkspace();
  const input = page.getByRole("textbox", {
    name: "Message",
  }) as HTMLTextAreaElement;

  fireEvent.click(page.getByRole("button", { name: /Draft a plan/ }));

  assert.equal(input.value, "Create a plan for validating an agent workflow.");
  expect(input).toBeEnabled();
  assert.ok(
    page.getByRole("heading", { name: "What would you like to work on?" }),
  );
});

test("navigation restores the saved collapse preference on a new page", () => {
  const page = renderWorkspace();

  fireEvent.click(page.getByRole("button", { name: "Collapse sidebar" }));

  assert.equal(
    localStorage.getItem("agent-playground-sidebar-collapsed"),
    "true",
  );
  page.unmount();
  const restored = renderWorkspace();

  assert.ok(restored.getByRole("button", { name: "Expand sidebar" }));
  assert.equal(
    restored.queryByRole("separator", { name: "Sidebar width" }),
    null,
  );
  fireEvent.click(restored.getByRole("button", { name: "Expand sidebar" }));

  assert.equal(
    localStorage.getItem("agent-playground-sidebar-collapsed"),
    "false",
  );
  restored.unmount();
  const expanded = renderWorkspace();

  assert.ok(expanded.getByRole("button", { name: "Collapse sidebar" }));
  assert.ok(expanded.getByRole("separator", { name: "Sidebar width" }));
});

test("navigation changes preserve pending review edits and keep new messages blocked", async () => {
  const page = renderWorkspace({
    messages: [],
    outputs: [],
    runs: [{ runId: "review-run", status: "interrupted" }],
    interrupts: [
      {
        id: "plan-review",
        reason: "Review",
        metadata: {
          langgraph: {
            raw: {
              kind: "experiment_plan_review",
              title: "Original plan",
              steps: ["Original step"],
            },
          },
        },
      },
    ],
  });

  await waitFor(() => assert.ok(page.getByLabelText("Title")));
  const title = page.getByLabelText("Title") as HTMLInputElement;
  const steps = page.getByLabelText(
    "Steps, one per line",
  ) as HTMLTextAreaElement;

  fireEvent.change(title, { target: { value: "My edited plan" } });
  fireEvent.change(steps, { target: { value: "Keep these edited steps" } });
  fireEvent.click(page.getByRole("button", { name: "Collapse sidebar" }));
  fireEvent.click(page.getByRole("button", { name: "Expand sidebar" }));

  assert.equal(page.getByLabelText("Title"), title);
  assert.equal(title.value, "My edited plan");
  assert.equal(steps.value, "Keep these edited steps");
  expect(page.getByRole("textbox", { name: "Message" })).toBeDisabled();
});

test("sidebar width can be adjusted with the keyboard and survives collapse", () => {
  localStorage.removeItem("agent-playground-sidebar-width");
  onTestFinished(() =>
    localStorage.removeItem("agent-playground-sidebar-width"),
  );
  const page = renderWorkspace();
  const separator = page.getByRole("separator", { name: "Sidebar width" });
  const input = page.getByRole("textbox", {
    name: "Message",
  }) as HTMLTextAreaElement;

  fireEvent.change(input, {
    target: { value: "Keep this draft while resizing" },
  });
  fireEvent.keyDown(separator, { key: "ArrowRight" });

  assert.equal(separator.getAttribute("aria-valuenow"), "336");
  assert.equal(localStorage.getItem("agent-playground-sidebar-width"), "336");
  fireEvent.click(page.getByRole("button", { name: "Collapse sidebar" }));
  fireEvent.click(page.getByRole("button", { name: "Expand sidebar" }));

  assert.equal(
    page
      .getByRole("separator", { name: "Sidebar width" })
      .getAttribute("aria-valuenow"),
    "336",
  );
  assert.equal(input.value, "Keep this draft while resizing");
  fireEvent.keyDown(page.getByRole("separator", { name: "Sidebar width" }), {
    key: "Home",
  });
  fireEvent.keyDown(page.getByRole("separator", { name: "Sidebar width" }), {
    key: "ArrowLeft",
  });

  assert.equal(
    page
      .getByRole("separator", { name: "Sidebar width" })
      .getAttribute("aria-valuenow"),
    "240",
  );
  fireEvent.keyDown(page.getByRole("separator", { name: "Sidebar width" }), {
    key: "End",
  });
  fireEvent.keyDown(page.getByRole("separator", { name: "Sidebar width" }), {
    key: "ArrowRight",
  });

  assert.equal(
    page
      .getByRole("separator", { name: "Sidebar width" })
      .getAttribute("aria-valuenow"),
    "420",
  );
});
