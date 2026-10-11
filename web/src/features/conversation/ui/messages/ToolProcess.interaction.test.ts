// @vitest-environment jsdom
import { test } from "vitest";
import assert from "node:assert/strict";
import { createElement } from "react";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToolProcess } from "./ToolProcess";
import { chatTurns, toolProcess } from "../../model/turns";

test.each([false, true])(
  "tool commentary and parameters open independently without changing the reply",
  async (multipart) => {
    const turn = chatTurns(
      [
        {
          id: "note",
          role: "assistant",
          content: "I'll check that for you.",
          toolCalls: [
            {
              id: "clock",
              type: "function",
              function: { name: "get_current_time", arguments: "{}" },
            },
          ],
        },
        {
          id: "result",
          role: "tool",
          toolCallId: "clock",
          content: multipart
            ? [{ type: "text", text: "12:00 UTC" }]
            : "12:00 UTC",
        },
      ],
      [],
    )[0]!;
    const page = render(
      createElement(ToolProcess, { process: toolProcess(turn) }),
    );
    const user = userEvent.setup();
    const summary = page.getByRole("button", {
      name: /Tool.*get_current_time.*Completed/,
    });

    assert.equal(page.queryByText("I'll check that for you."), null);
    await user.click(summary);
    assert.ok(page.getByText("I'll check that for you."));
    assert.equal(
      page.queryByText("get_current_time", { selector: "code" }),
      null,
    );
    await user.click(
      page.getByRole("button", { name: /Check the time\s*Completed/ }),
    );
    assert.ok(page.getByText("get_current_time", { selector: "code" }));
    assert.ok(page.getByText("12:00 UTC"));
    await user.click(summary);
    assert.equal(page.queryByText("I'll check that for you."), null);
  },
);
