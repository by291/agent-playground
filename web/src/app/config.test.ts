import { test } from "vitest";
import assert from "node:assert/strict";
import { readAppConfig } from "./config";

test("missing environment uses production controls and disables tracing", () => {
  assert.deepEqual(readAppConfig(undefined), {
    development: false,
    observabilityEnabled: false,
  });
});

test("valid environment enables development controls and tracing explicitly", () => {
  assert.deepEqual(
    readAppConfig({ DEV: true, VITE_OBSERVABILITY_ENABLED: "true" }),
    {
      development: true,
      observabilityEnabled: true,
    },
  );
});

test("invalid environment values are rejected instead of silently changing behavior", () => {
  assert.throws(() => readAppConfig({ VITE_OBSERVABILITY_ENABLED: "yes" }));
  assert.throws(() => readAppConfig({ DEV: "true" }));
});
