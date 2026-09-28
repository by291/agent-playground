import { test } from "vitest";
import assert from "node:assert/strict";
import { EventType } from "@ag-ui/client";
import { parseA2UIMessages } from "./messages";
import { parseA2UIEvent, parseA2UIOutput } from "./outputs";

test("accepts the official message wrapper and update-only message lists", () => {
  const messages = [
    {
      version: "v0.9",
      updateDataModel: { surfaceId: "main", path: "/title", value: "Updated" },
    },
  ];

  assert.deepEqual(parseA2UIMessages({ messages }), messages);
  assert.deepEqual(parseA2UIMessages(messages), messages);
  assert.equal(
    parseA2UIMessages([
      { version: "v0.9", deleteSurface: { surfaceId: "main" } },
    ]).length,
    1,
  );
});

test("the transport adapter validates output identity and does not parse ordinary tool results", () => {
  const value = {
    id: "output",
    outputSeq: 1,
    messages: [{ version: "v0.9", deleteSurface: { surfaceId: "main" } }],
  };

  assert.equal(
    parseA2UIEvent({ type: EventType.CUSTOM, name: "a2ui", value })?.id,
    "output",
  );
  assert.equal(
    parseA2UIEvent({ type: EventType.CUSTOM, name: "other", value }),
    null,
  );
  assert.equal(
    parseA2UIEvent({
      type: EventType.TOOL_CALL_RESULT,
      content: "Ordinary result",
    }),
    null,
  );
  assert.throws(
    () => parseA2UIOutput({ ...value, outputSeq: 0 }),
    /Invalid A2UI output/,
  );
  assert.throws(
    () => parseA2UIOutput({ ...value, kind: "a2ui" }),
    /Invalid A2UI output/,
  );
  assert.throws(
    () =>
      parseA2UIEvent({
        type: EventType.CUSTOM,
        name: "a2ui",
        value: { ...value, messages: [{}] },
      }),
    /Invalid A2UI output/,
  );
});
