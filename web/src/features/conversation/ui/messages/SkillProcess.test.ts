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
