// @vitest-environment jsdom
import { test, expect, vi } from "vitest";
import { createElement } from "react";
import { act, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Message } from "@ag-ui/client";
import { AssistantReply } from "./AssistantReply";
import { chatTurns } from "../../model/turns";
import { conversationView } from "../../model/conversation-view";

test("reasoning opens while thinking and folds on visible answer text without overriding later user choices", async () => {
  const messages: Message[] = [
    { id: "question", role: "user", content: "Compare two approaches" },
    {
      id: "reason",
      role: "reasoning",
      content: "First, compare the constraints.",
    },
  ];
  const turn = () =>
    chatTurns(messages, [
      { runId: "run", messageId: "question", status: "running" },
    ])[0]!;
  const page = render(
    createElement(AssistantReply, { turn: turn(), animatedMessageId: null }),
  );
  const user = userEvent.setup();

  expect(page.getByRole("button", { name: "Thinking" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  expect(page.getByText("First, compare the constraints.")).toBeVisible();
  messages.push({ id: "answer", role: "assistant", content: "" });
  page.rerender(
    createElement(AssistantReply, { turn: turn(), animatedMessageId: null }),
  );
  expect(page.getByText("First, compare the constraints.")).toBeVisible();
  messages[2] = {
    id: "answer",
    role: "assistant",
    content: "Approach A is simpler.",
  };
  page.rerender(
    createElement(AssistantReply, { turn: turn(), animatedMessageId: null }),
  );
  const toggle = page.getByRole("button", { name: "Reasoning" });

  await waitFor(() => expect(toggle).toHaveAttribute("aria-expanded", "false"));
  await waitFor(() =>
    expect(page.queryByText("First, compare the constraints.")).toBeNull(),
  );
  expect(page.getByText("Approach A is simpler.")).toBeVisible();
  await user.click(toggle);
  await waitFor(() =>
    expect(page.getByText("First, compare the constraints.")).toBeVisible(),
  );
  messages[2] = {
    id: "answer",
    role: "assistant",
    content: "Approach A is simpler. Approach B is more flexible.",
  };
  page.rerender(
    createElement(AssistantReply, { turn: turn(), animatedMessageId: null }),
  );
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(toggle).toHaveFocus();
  messages[1] = {
    id: "checkpoint-reason",
    role: "reasoning",
    content: "First, compare the constraints.",
  };
  page.rerender(
    createElement(AssistantReply, {
      turn: { ...turn(), status: "completed" },
      animatedMessageId: null,
    }),
  );
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(toggle).toHaveFocus();
  await user.click(toggle);
  messages.push({
    id: "next-reason",
    role: "reasoning",
    content: "Now check the tradeoffs.",
  });
  page.rerender(
    createElement(AssistantReply, { turn: turn(), animatedMessageId: null }),
  );
  await waitFor(() =>
    expect(page.getByText("Now check the tradeoffs.")).toBeVisible(),
  );
});

test("reasoning stays open until the paced answer actually renders text", async () => {
  let nextFrame: FrameRequestCallback | undefined;

  vi.useFakeTimers({ toFake: ["Date"], now: 0 });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    nextFrame = callback;

    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {
    nextFrame = undefined;
  });
  const turn = chatTurns(
    [
      { id: "question", role: "user", content: "Compare options" },
      { id: "reason", role: "reasoning", content: "Compare the constraints." },
      { id: "answer", role: "assistant", content: "Answer A is simpler." },
    ],
    [{ runId: "run", messageId: "question", status: "running" }],
  )[0]!;
  const page = render(
    createElement(AssistantReply, { turn, animatedMessageId: "answer" }),
  );
  const toggle = page.getByRole("button", { name: "Reasoning" });

  expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(page.getByText("Compare the constraints.")).toBeVisible();
  expect(page.queryByText(/Answer A/)).toBeNull();
  await act(async () => {
    vi.setSystemTime(68);
    nextFrame?.(68);
    await Promise.resolve();
  });
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(page.getByText("Answ")).toBeVisible();
});

test("an empty code fence does not fold reasoning before its code body appears", async () => {
  const messages: Message[] = [
    { id: "question", role: "user", content: "Show Python code" },
    { id: "reason", role: "reasoning", content: "Choose a small example." },
    { id: "answer", role: "assistant", content: "```python\n" },
  ];
  const turn = () =>
    chatTurns(messages, [
      { runId: "run", messageId: "question", status: "running" },
    ])[0]!;
  const page = render(
    createElement(AssistantReply, { turn: turn(), animatedMessageId: null }),
  );
  const toggle = page.getByRole("button", { name: "Reasoning" });

  await waitFor(() => expect(page.getByText("python")).toBeVisible());
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(page.getByText("Choose a small example.")).toBeVisible();
  messages[2] = {
    id: "answer",
    role: "assistant",
    content: "```python\nprint(1)\n```",
  };
  page.rerender(
    createElement(AssistantReply, { turn: turn(), animatedMessageId: null }),
  );
  await waitFor(() => expect(toggle).toHaveAttribute("aria-expanded", "false"));
  await waitFor(() =>
    expect(page.queryByText("Choose a small example.")).toBeNull(),
  );
  expect(page.container.querySelector("code")?.textContent).toContain(
    "print(1)",
  );
});

test("a live reasoning-only failure leaves the visible reasoning open", () => {
  const turn = chatTurns(
    [
      { id: "question", role: "user", content: "Explain the failure" },
      {
        id: "reason",
        role: "reasoning",
        content: "The input could not be resolved.",
      },
    ],
    [{ runId: "run", messageId: "question", status: "running" }],
  )[0]!;
  const page = render(
    createElement(AssistantReply, { turn, animatedMessageId: null }),
  );

  expect(page.getByText("The input could not be resolved.")).toBeVisible();
  page.rerender(
    createElement(AssistantReply, {
      turn: { ...turn, status: "failed" },
      animatedMessageId: null,
    }),
  );
  expect(page.getByRole("button", { name: "Reasoning" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  expect(page.getByText("The input could not be resolved.")).toBeVisible();
});

test("restored reasoning-only replies remain accessible and start collapsed", async () => {
  const view = conversationView({
    messages: [
      { id: "question", role: "user", content: "Explain the failure" },
      {
        id: "reason",
        role: "reasoning",
        content: "The input could not be resolved.",
      },
    ],
    runs: [{ runId: "run", messageId: "question", status: "failed" }],
    surfaces: [],
    pendingInterrupts: [],
  });

  expect(view.turns[0]?.hasReply).toBe(true);
  const page = render(
    createElement(AssistantReply, {
      turn: view.turns[0]!.turn,
      animatedMessageId: null,
    }),
  );
  const user = userEvent.setup();
  const toggle = page.getByRole("button", { name: "Reasoning" });

  expect(toggle).toHaveAttribute("aria-expanded", "false");
  await user.click(toggle);
  await waitFor(() =>
    expect(page.getByText("The input could not be resolved.")).toBeVisible(),
  );
});
