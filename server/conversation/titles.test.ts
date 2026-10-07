import assert from "node:assert/strict";
import { test } from "vitest";
import type { Message } from "@ag-ui/client";
import { uploadedFileMessage } from "../../shared/uploaded-files";
import { defaultConversationTitle, presentConversationTitle } from "./titles";

test("attachment titles use only the user body and preserve custom titles", () => {
  const message: Message = {
    id: "first",
    role: "user",
    content: uploadedFileMessage("Read this image.", [
      { id: "9c6146a4-be1a-471e-b804-9fe97ab5eaaf", name: "screen.png" },
    ]),
  };

  assert.ok(typeof message.content === "string");
  const legacy = Array.from(message.content.replace(/\s+/g, " ").trim())
    .slice(0, 100)
    .join("");

  assert.equal(defaultConversationTitle(message), "Read this image.");
  assert.equal(presentConversationTitle(legacy, message), "Read this image.");
  assert.equal(
    presentConversationTitle("My image notes", message),
    "My image notes",
  );
  assert.equal(
    defaultConversationTitle({
      id: "emoji",
      role: "user",
      content: "😀".repeat(110),
    }),
    "😀".repeat(100),
  );
});
