// @vitest-environment jsdom
import { createElement } from "react";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { AssistantReply } from "./AssistantReply";
import { chatTurns } from "../../model/turns";

test("Skill executions expose their identity separately from ordinary tools after reload", async () => {
  const turn = chatTurns(
    [
      {
        id: "execution",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "skill",
            type: "function",
            function: {
              name: "run_skill_script",
              arguments: JSON.stringify({
                skill_name: "csv-summary",
                script_path: "scripts/summarize.py",
              }),
            },
          },
          {
            id: "clock",
            type: "function",
            function: { name: "get_current_time", arguments: "{}" },
          },
        ],
      },
      {
        id: "skill-result",
        role: "tool",
        toolCallId: "skill",
        content: JSON.stringify({
          kind: "skill_script_result",
          exitCode: 0,
          stdout: "Total: 20",
          stderr: "",
          error: null,
          files: [],
        }),
      },
      {
        id: "clock-result",
        role: "tool",
        toolCallId: "clock",
        content: "12:00 UTC",
      },
    ],
    [],
  )[0]!;
  const view = render(
    createElement(AssistantReply, { turn, animatedMessageId: null }),
  );
  const user = userEvent.setup();

  expect(
    view.getByRole("button", { name: /Skill.*csv-summary.*Completed/ }),
  ).toBeInTheDocument();
  expect(
    view.getByRole("button", { name: /Tool.*get_current_time.*Completed/ }),
  ).toBeInTheDocument();
  await user.click(
    view.getByRole("button", { name: /Skill.*csv-summary.*Completed/ }),
  );
  expect(
    view.getByRole("button", { name: /scripts\/summarize.py/ }),
  ).toBeInTheDocument();
  expect(
    view.queryByRole("button", { name: /Check the time.*Completed/ }),
  ).toBeNull();
});

test("streaming Skill arguments keep a Skill category and expose running and failure states", () => {
  function reply(arguments_: string, status: "running" | "failed") {
    const turn = chatTurns(
      [
        {
          id: "streamed-call",
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "skill",
              type: "function",
              function: { name: "run_skill_script", arguments: arguments_ },
            },
          ],
        },
      ],
      [{ runId: "live-run", status }],
    )[0]!;

    return createElement(AssistantReply, { turn, animatedMessageId: null });
  }

  const view = render(reply("{", "running"));

  expect(
    view.getByRole("button", { name: /Skill.*Loading….*Running/ }),
  ).toBeInTheDocument();
  view.rerender(
    reply(
      JSON.stringify({
        skill_name: "csv-summary",
        script_path: "scripts/summarize.py",
      }),
      "running",
    ),
  );
  expect(
    view.getByRole("button", { name: /Skill.*csv-summary.*Running/ }),
  ).toBeInTheDocument();
  expect(view.queryByRole("button", { name: /^Tool / })).toBeNull();
  view.rerender(reply(JSON.stringify({ skill_name: "csv-summary" }), "failed"));
  expect(
    view.getByRole("button", { name: /Skill.*csv-summary.*Failed/ }),
  ).toBeInTheDocument();
});

test("memory operations form their own group beside tools and a Skill named Memory", async () => {
  const names = ["search_memory", "remember_memory", "forget_memory"];
  const turn = chatTurns(
    [
      {
        id: "mixed-caller",
        role: "assistant",
        content: "",
        toolCalls: [
          ...names.map((name) => ({
            id: name,
            type: "function" as const,
            function: { name, arguments: "{}" },
          })),
          {
            id: "clock",
            type: "function",
            function: { name: "get_current_time", arguments: "{}" },
          },
          {
            id: "skill",
            type: "function",
            function: {
              name: "load_skill",
              arguments: '{"skill_name":"Memory"}',
            },
          },
        ],
      },
      ...[...names, "clock", "skill"].map((toolCallId) => ({
        id: `${toolCallId}-result`,
        role: "tool" as const,
        toolCallId,
        content: "Done",
      })),
    ],
    [],
  )[0]!;
  const view = render(
    createElement(AssistantReply, { turn, animatedMessageId: null }),
  );
  const user = userEvent.setup();
  const memory = view.getByRole("button", {
    name: "Memory 3 operations Completed",
  });

  expect(
    view.getByRole("button", { name: "Skill Memory Completed" }),
  ).toBeInTheDocument();
  expect(
    view.getByRole("button", { name: "Tool get_current_time Completed" }),
  ).toBeInTheDocument();
  await user.click(memory);
  expect(
    view.getByRole("button", { name: /Search memory.*Completed/ }),
  ).toBeInTheDocument();
  expect(
    view.getByRole("button", { name: /Remember a fact.*Completed/ }),
  ).toBeInTheDocument();
  expect(
    view.getByRole("button", { name: /Forget a fact.*Completed/ }),
  ).toBeInTheDocument();
  expect(
    view.queryByRole("button", { name: /Check the time.*Completed/ }),
  ).toBeNull();
  expect(
    view.queryByRole("button", { name: /Load a Skill.*Completed/ }),
  ).toBeNull();
});

test("Memory disclosure and focus survive streamed parameters and result status changes", async () => {
  function reply(
    arguments_: string,
    result?: { content: string; error?: string },
  ) {
    const turn = chatTurns(
      [
        {
          id: "caller",
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "remember",
              type: "function",
              function: { name: "remember_memory", arguments: arguments_ },
            },
          ],
        },
        ...(result
          ? [
              {
                id: "result",
                role: "tool" as const,
                toolCallId: "remember",
                ...result,
              },
            ]
          : []),
      ],
      [{ runId: "run", status: "running" }],
    )[0]!;

    return createElement(AssistantReply, { turn, animatedMessageId: null });
  }

  const view = render(reply("{"));
  const user = userEvent.setup();
  const memory = view.getByRole("button", {
    name: "Memory remember_memory Running",
  });

  await user.click(memory);
  expect(memory).toHaveAttribute("aria-expanded", "true");
  view.rerender(
    reply('{"text":"Prefer concise answers."}', { content: "Saved" }),
  );
  expect(
    view.getByRole("button", { name: "Memory remember_memory Completed" }),
  ).toBe(memory);
  expect(memory).toHaveAttribute("aria-expanded", "true");
  expect(memory).toHaveFocus();
  view.rerender(reply("{}", { content: "", error: "Memory unavailable" }));
  expect(
    view.getByRole("button", { name: "Memory remember_memory Failed" }),
  ).toBe(memory);
  expect(view.getByRole("alert")).toHaveTextContent("Memory unavailable");
  expect(view.queryByRole("button", { name: /^Tool / })).toBeNull();
});
