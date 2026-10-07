import { test } from "vitest";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageRow } from "./MessageRow";
import { uploadedFileMessage } from "@shared/uploaded-files";

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

test("restored user attachments display previews and downloads without protocol text", () => {
  const markup = renderToStaticMarkup(
    createElement(MessageRow, {
      threadId: "saved-chat",
      message: {
        id: "saved-upload",
        role: "user",
        content: uploadedFileMessage("Read this image.", [
          { id: "9c6146a4-be1a-471e-b804-9fe97ab5eaaf", name: "screen.png" },
          { id: "947b836e-e0ce-4d08-8d99-707d887a4c65", name: "orders.csv" },
        ]),
      },
    }),
  );

  assert.match(markup, /Read this image\./);
  assert.match(markup, /alt="screen.png"/);
  assert.match(markup, /aria-label="Preview screen.png"/);
  assert.match(markup, /aria-label="Download orders.csv"/);
  assert.doesNotMatch(markup, /Uploaded files:|File ID:/);
});
