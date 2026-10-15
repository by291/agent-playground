// @vitest-environment jsdom
import { fireEvent, render, waitFor } from "@testing-library/react";
import { createElement, Fragment } from "react";
import { expect, test, vi } from "vitest";
import { parseAgentInteraction } from "@shared/agent-interaction";
import { AgentInteractionPanel } from "./AgentInteractionPanel";

const interaction = parseAgentInteraction({
  id: "questions",
  metadata: {
    langgraph: {
      raw: {
        action_requests: [
          {
            name: "ask_user",
            args: {
              questions: [
                {
                  id: "audience",
                  question: "Who is this for?",
                  options: [
                    {
                      label: "Engineering",
                      description: "Include implementation details.",
                    },
                    { label: "Leadership" },
                  ],
                },
                { id: "deadline", question: "When is it needed?" },
              ],
            },
          },
        ],
        review_configs: [
          { action_name: "ask_user", allowed_decisions: ["respond", "reject"] },
        ],
      },
    },
  },
})!;

test("choices hide text input and redundant modes, with question paging and footer submission", async () => {
  const respond = vi.fn(() => Promise.resolve());
  const view = render(
    createElement(
      Fragment,
      null,
      createElement("button", null, "Keep focus"),
      createElement(AgentInteractionPanel, {
        interaction,
        busy: false,
        onRespond: respond,
      }),
    ),
  );

  view.getByRole("button", { name: "Keep focus" }).focus();
  expect(view.getByRole("button", { name: "Keep focus" })).toHaveFocus();
  expect(
    view.queryByRole("radio", { name: "Answer questions" }),
  ).not.toBeInTheDocument();
  expect(view.queryByRole("radio", { name: "Reject" })).not.toBeInTheDocument();
  expect(view.queryByRole("textbox")).not.toBeInTheDocument();
  expect(view.getByText("Question", { exact: true })).toBeVisible();
  expect(view.getByRole("button", { name: "Close question" })).toBeEnabled();
  expect(
    view.getByRole("button", { name: "Write your own answer" }),
  ).toBeVisible();
  expect(
    view.container.querySelector('[data-slot="question-option-number"]'),
  ).toHaveTextContent("1");
  expect(view.queryByText("When is it needed?")).not.toBeInTheDocument();
  expect(view.getByRole("button", { name: "Next" })).toBeDisabled();

  fireEvent.click(view.getByRole("radio", { name: /Engineering/ }));
  expect(view.queryByRole("textbox")).not.toBeInTheDocument();
  expect(respond).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole("button", { name: "Next" }));
  fireEvent.change(
    view.getByRole("textbox", { name: "Your answer: When is it needed?" }),
    { target: { value: "Friday" } },
  );
  fireEvent.click(view.getByRole("button", { name: "Send" }));

  await waitFor(() =>
    expect(respond).toHaveBeenCalledWith(interaction, {
      decisions: [
        {
          type: "respond",
          message: JSON.stringify({
            answers: [
              { id: "audience", answer: "Engineering" },
              { id: "deadline", answer: "Friday" },
            ],
          }),
        },
      ],
    }),
  );
});

test("The custom answer affordance retains explicit custom mode and text across option switches and paging", () => {
  const view = render(
    createElement(AgentInteractionPanel, {
      interaction,
      busy: false,
      onRespond: vi.fn(),
    }),
  );
  const other = view.getByRole("button", { name: "Write your own answer" });

  fireEvent.click(other);
  fireEvent.change(
    view.getByRole("textbox", { name: "Your answer: Who is this for?" }),
    { target: { value: "Engineering" } },
  );
  expect(other).toHaveAttribute("aria-pressed", "true");
  expect(view.getByRole("textbox")).toBeVisible();

  fireEvent.click(view.getByRole("radio", { name: "Leadership" }));
  expect(view.queryByRole("textbox")).not.toBeInTheDocument();
  fireEvent.click(other);
  expect(view.getByRole("textbox")).toHaveValue("Engineering");
  fireEvent.click(view.getByRole("button", { name: "Next" }));
  fireEvent.click(view.getByRole("button", { name: "Back" }));
  expect(
    view.getByRole("button", { name: "Write your own answer" }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(view.getByRole("textbox")).toHaveValue("Engineering");
});

test("failed submission retains answers and permits retry", async () => {
  const respond = vi.fn(() => Promise.reject(new Error("Connection lost")));
  const view = render(
    createElement(AgentInteractionPanel, {
      interaction,
      busy: false,
      onRespond: respond,
    }),
  );

  fireEvent.click(view.getByRole("radio", { name: /Engineering/ }));
  fireEvent.click(view.getByRole("button", { name: "Next" }));
  fireEvent.change(view.getByRole("textbox"), { target: { value: "Today" } });
  fireEvent.click(view.getByRole("button", { name: "Send" }));

  await waitFor(() =>
    expect(view.getByRole("alert")).toHaveTextContent("Connection lost"),
  );
  expect(view.getByRole("textbox")).toHaveValue("Today");
  expect(view.getByRole("button", { name: "Send" })).toBeEnabled();
});

function toolApproval() {
  return parseAgentInteraction({
    id: "approval",
    metadata: {
      langgraph: {
        raw: {
          action_requests: [
            {
              name: "run_skill_script",
              args: { script_path: "scripts/export.py" },
              description: "Export the report.",
            },
          ],
          review_configs: [
            {
              action_name: "run_skill_script",
              allowed_decisions: ["approve", "reject"],
            },
          ],
        },
      },
    },
  })!;
}

test.each(["Allow once", "Reject"])(
  "tool approval has an explicit %s footer button",
  async (button) => {
    const approval = toolApproval();
    const respond = vi.fn(() => Promise.resolve());
    const view = render(
      createElement(AgentInteractionPanel, {
        interaction: approval,
        busy: false,
        onRespond: respond,
      }),
    );

    expect(view.queryByRole("radio")).not.toBeInTheDocument();
    expect(respond).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole("button", { name: button }));

    await waitFor(() =>
      expect(respond).toHaveBeenCalledWith(approval, {
        decisions: [{ type: button === "Reject" ? "reject" : "approve" }],
      }),
    );
  },
);

test.each(["Skip", "Close question"])(
  "%s declines the complete question action without requiring answers",
  async (button) => {
    const respond = vi.fn(() => Promise.resolve());
    const view = render(
      createElement(AgentInteractionPanel, {
        interaction,
        busy: false,
        onRespond: respond,
      }),
    );

    fireEvent.click(view.getByRole("button", { name: button }));

    await waitFor(() =>
      expect(respond).toHaveBeenCalledWith(interaction, {
        decisions: [{ type: "reject" }],
      }),
    );
  },
);

test("mixed batches require explicit tool approval after answering every question", async () => {
  const batch = structuredClone(interaction);

  batch.action_requests.push(toolApproval().action_requests[0]!);
  batch.review_configs.push(toolApproval().review_configs[0]!);
  const respond = vi.fn(() => Promise.resolve());
  const view = render(
    createElement(AgentInteractionPanel, {
      interaction: batch,
      busy: false,
      onRespond: respond,
    }),
  );

  fireEvent.click(view.getByRole("radio", { name: /Engineering/ }));
  fireEvent.click(view.getByRole("button", { name: "Next" }));
  fireEvent.change(view.getByRole("textbox"), { target: { value: "Today" } });
  fireEvent.click(view.getByRole("button", { name: "Next" }));
  expect(
    view.getByRole("heading", { name: "Allow run skill script?" }),
  ).toBeVisible();
  expect(respond).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole("button", { name: "Allow once" }));

  await waitFor(() =>
    expect(respond).toHaveBeenCalledWith(batch, {
      decisions: [
        expect.objectContaining({ type: "respond" }),
        { type: "approve" },
      ],
    }),
  );
});

test("reject-only requests cannot be approved", () => {
  const approval = toolApproval();

  approval.review_configs[0]!.allowed_decisions = ["reject"];
  const view = render(
    createElement(AgentInteractionPanel, {
      interaction: approval,
      busy: false,
      onRespond: vi.fn(),
    }),
  );

  expect(
    view.queryByRole("button", { name: "Allow once" }),
  ).not.toBeInTheDocument();
  expect(view.getByRole("button", { name: "Reject" })).toBeEnabled();
});

test("paging resets scroll while keeping focus on the navigation button", () => {
  const view = render(
    createElement(AgentInteractionPanel, {
      interaction,
      busy: false,
      onRespond: vi.fn(),
    }),
  );
  const body = view.container.querySelector<HTMLElement>(
    '[data-slot="interaction-body"]',
  )!;

  body.scrollTop = 120;
  fireEvent.click(view.getByRole("radio", { name: /Engineering/ }));
  const next = view.getByRole("button", { name: "Next" });

  next.focus();
  fireEvent.click(next);

  const nextBody = view.container.querySelector<HTMLElement>(
    '[data-slot="interaction-body"]',
  )!;

  expect(nextBody.scrollTop).toBe(0);
  expect(next).toHaveFocus();
});
