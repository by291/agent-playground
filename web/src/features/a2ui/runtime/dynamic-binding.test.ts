import assert from "node:assert/strict";
import { test } from "vitest";
import { dynamicText } from "./dynamic-binding";

test("official function bindings can omit arguments", () => {
  const value = { call: "summary", returnType: "string" };

  assert.equal(dynamicText.safeParse(value).success, true);
});
