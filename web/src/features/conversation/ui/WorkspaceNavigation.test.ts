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
    if (url === "/agent-info") {
      return Promise.resolve(Response.json({ model: "test-model" }));
    }

    if (url === "/health") {
      return Promise.resolve(new Response());
    }

    return Promise.resolve(Response.json(snapshot));
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

test("the model control opens context details beside send without losing the draft", async () => {
  const page = renderWorkspace();
  const input = page.getByRole("textbox", { name: "Message" });

  fireEvent.change(input, { target: { value: "Keep this task" } });
  const model = await page.findByRole("button", {
    name: /test-model.*Show details/,
  });
  const send = page.getByRole("button", { name: "Send message" });

  assert.ok(input.closest("form")?.contains(model));
  assert.equal(model.parentElement, send.parentElement);
  assert.ok(!page.container.querySelector("header")?.contains(model));
  model.focus();
  fireEvent.click(model);
  assert.ok(page.getByLabelText("Context usage details"));
  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() =>
    assert.equal(page.queryByLabelText("Context usage details"), null),
  );

  assert.equal(document.activeElement, model);
  assert.equal((input as HTMLTextAreaElement).value, "Keep this task");
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

test("restored context usage remains available from the model control", async () => {
  const page = renderWorkspace({
    messages: [],
    outputs: [],
    interrupts: [],
    runs: [],
    contextUsage: {
      model: "test-model",
      usedTokens: 1000,
      contextWindow: 100_000,
      triggerTokens: 80_000,
      breakdown: {
        system: 200,
        tools: 100,
        conversation: 700,
        toolResults: 0,
        summary: 0,
      },
      lastInputTokens: null,
      compactions: 0,
      lastCompaction: null,
      revision: 1,
    },
  });
  const model = await page.findByRole("button", {
    name: "test-model. Estimated context usage 1%. Show details",
  });

  fireEvent.click(model);
  assert.equal(
    page
      .getByRole("progressbar", { name: "Estimated context usage" })
      .getAttribute("aria-valuenow"),
    "1000",
  );
  assert.ok(page.getByText("Auto-compacts at 80%."));
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
