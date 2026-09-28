import { test } from "vitest";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageRow } from "./MessageRow";

test("restored assistant replies render Markdown paragraphs on their first render", () => {
  const markup = renderToStaticMarkup(
    createElement(MessageRow, {
      message: {
        id: "saved-greeting",
        role: "assistant",
        content:
          "你好！有什么可以帮你的吗？\n\n比如：查当前时间、做加法计算，或者规划一个**实验方案**。",
      },
    }),
  );

  assert.equal(
    (markup.match(/<p(?:\s|>)/g) ?? []).length,
    2,
    "Both paragraphs must use the Markdown layout from the first render",
  );
  assert.match(markup, /data-streamdown="strong"/);
  assert.doesNotMatch(markup, /whitespace-pre-wrap/);
});
