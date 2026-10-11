// @vitest-environment jsdom
import assert from "node:assert/strict";
import { createElement } from "react";
import { render } from "@testing-library/react";
import { test } from "vitest";
import { AssistantReply } from "./AssistantReply";
import { chatTurns } from "../../model/turns";

test.each([false, true])(
  "recovered Skill outputs are downloadable while the tool process is collapsed",
  (multipart) => {
    const resultContent = JSON.stringify({
      kind: "skill_script_result",
      exitCode: 0,
      stdout: "done",
      stderr: "",
      error: null,
      files: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          threadId: "file-thread",
          name: "summary.json",
          size: 20,
        },
      ],
    });

    const turn = chatTurns(
      [
        {
          id: "call",
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "script",
              type: "function",
              function: { name: "run_skill_script", arguments: "{}" },
            },
          ],
        },
        {
          id: "result",
          role: "tool",
          toolCallId: "script",
          content: multipart
            ? [{ type: "text", text: resultContent }]
            : resultContent,
        },
      ],
      [],
    )[0]!;
    const view = render(
      createElement(AssistantReply, { turn, animatedMessageId: null }),
    );
    const link = view.getByRole("link", { name: /summary.json/ });

    assert.equal(
      link.getAttribute("href"),
      "/conversations/file-thread/files/00000000-0000-4000-8000-000000000001",
    );
    assert.equal(link.getAttribute("download"), "summary.json");
    assert.equal(view.queryByText("done"), null);
  },
);
